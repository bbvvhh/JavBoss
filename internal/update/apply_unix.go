//go:build !windows

package update

import "context"

// platformApply 直接逐文件原子替换（见 replaceAll）。
//
// Unix 上运行中的可执行文件也能被 rename 覆盖：进程继续持有旧 inode，
// 重启后才用上新版本，所以替换完只需要提示用户重启。
func platformApply(ctx context.Context, opts ApplyOptions, plan []PlanEntry, result AppliedResult) (AppliedResult, error) {
	replaced, err := replaceAll(ctx, plan)
	if err != nil {
		return AppliedResult{}, err
	}
	result.FileCount = len(replaced)
	return result, nil
}

// ExitForUpdate 在非 Windows 平台上什么都不做：
// 运行中的文件已经替换好了，重启由用户自己决定，不需要进程退出配合。
func ExitForUpdate() {}
