package update

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// headerPeekSize 是读取可执行文件头部用于识别架构的字节数。
// PE 的 e_lfanew 多数是 0x40 或 0x80，4 KiB 足够覆盖实际发布包。
const headerPeekSize = 4096

// MainBinaryName 返回 goos 上程序主可执行文件名。
func MainBinaryName(goos string) string {
	if goos == "windows" {
		return "javboss.exe"
	}
	return "javboss"
}

// VerifySidecar 校验归档旁边的 .sha256 边车文件。
//
// 边车存在就强制比对；不存在直接放行（proot 发布包带边车，Windows 发布包没有）。
func VerifySidecar(archivePath string) error {
	sidecar := archivePath + Sha256Ext
	content, err := os.ReadFile(sidecar)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read checksum file: %w", err)
	}
	expected, err := parseChecksum(string(content))
	if err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(sidecar), err)
	}
	actual, err := fileChecksum(archivePath)
	if err != nil {
		return err
	}
	if expected != actual {
		return fmt.Errorf("update package %s does not match its checksum file", filepath.Base(archivePath))
	}
	return nil
}

// ValidateManifest 确认解压结果里有当前平台的主程序，并且架构一致。
func ValidateManifest(manifest Manifest, goos, goarch string) error {
	name := MainBinaryName(goos)
	for _, entry := range manifest.Entries {
		if entry.Rel != name {
			continue
		}
		return VerifyBinaryArchitecture(entry.Path, goarch)
	}
	return fmt.Errorf("update package does not contain %s", name)
}

// VerifyBinaryArchitecture 校验可执行文件的架构与当前程序一致。
// 更新等同于用远端内容替换可执行程序，架构不符必须在这里挡住
// （逻辑与 scripts/build-proot-arm64.sh 的 verify_elf 一致，并额外支持 PE）。
func VerifyBinaryArchitecture(path, goarch string) error {
	header, err := readHeader(path)
	if err != nil {
		return err
	}
	format, machine, err := machineOf(header)
	if err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	var expected []uint16
	switch format {
	case formatELF:
		expected = elfMachines[goarch]
	case formatPE:
		expected = peMachines[goarch]
	}
	if len(expected) == 0 {
		return fmt.Errorf("%s: unsupported architecture %s", filepath.Base(path), goarch)
	}
	for _, want := range expected {
		if machine == want {
			return nil
		}
	}
	return fmt.Errorf("%s was built for a different architecture", filepath.Base(path))
}

// fileFormat 是可执行文件的容器格式。
type fileFormat string

const (
	formatELF fileFormat = "ELF"
	formatPE  fileFormat = "PE"
)

// elfMachines / peMachines 把 GOARCH 映射到各格式里的机器码。
var (
	elfMachines = map[string][]uint16{
		"amd64": {62},
		"arm64": {183},
		"arm":   {40},
		"386":   {3},
	}
	peMachines = map[string][]uint16{
		"amd64": {0x8664},
		"arm64": {0xaa64},
		"386":   {0x014c},
	}
)

var elfMagic = []byte{0x7f, 'E', 'L', 'F'}

// readHeader 读出文件开头的一段字节，用于识别容器格式与机器码。
func readHeader(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	defer file.Close()
	buffer := make([]byte, headerPeekSize)
	n, err := io.ReadFull(file, buffer)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return buffer[:n], nil
}

// machineOf 识别可执行文件的格式并取出机器码。
func machineOf(header []byte) (fileFormat, uint16, error) {
	if len(header) >= 20 && bytes.Equal(header[:4], elfMagic) {
		var order binary.ByteOrder
		switch header[5] {
		case 1:
			order = binary.LittleEndian
		case 2:
			order = binary.BigEndian
		default:
			return "", 0, errors.New("invalid ELF byte order")
		}
		return formatELF, order.Uint16(header[18:20]), nil
	}
	if len(header) >= 64 && header[0] == 'M' && header[1] == 'Z' {
		offset := int(binary.LittleEndian.Uint32(header[0x3c:0x40]))
		if offset <= 0 || offset+6 > len(header) {
			return "", 0, errors.New("truncated PE header")
		}
		if !bytes.Equal(header[offset:offset+4], []byte{'P', 'E', 0, 0}) {
			return "", 0, errors.New("invalid PE signature")
		}
		return formatPE, binary.LittleEndian.Uint16(header[offset+4 : offset+6]), nil
	}
	return "", 0, errors.New("not a supported executable")
}

// parseChecksum 从边车内容里取出 sha256 十六进制串。
// 容忍 `sha256sum` 的「hash  filename」格式，多余字段忽略。
func parseChecksum(content string) (string, error) {
	fields := strings.Fields(content)
	if len(fields) == 0 {
		return "", errors.New("checksum file is empty")
	}
	value := strings.ToLower(fields[0])
	if len(value) != sha256.Size*2 {
		return "", errors.New("checksum file does not contain a sha256 digest")
	}
	if _, err := hex.DecodeString(value); err != nil {
		return "", errors.New("checksum file does not contain a sha256 digest")
	}
	return value, nil
}

func fileChecksum(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
