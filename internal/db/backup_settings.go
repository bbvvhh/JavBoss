package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
)

// GetBackupSettings 返回备份设置；表里没有记录时返回空设置的默认值。
func GetBackupSettings(ctx context.Context) (*models.BackupSettings, error) {
	if common.DB == nil {
		return nil, errors.New("get backup settings: nil db")
	}
	var settings models.BackupSettings
	err := common.DB.WithContext(ctx).First(&settings, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.BackupSettings{ID: 1}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get backup settings: %w", err)
	}
	return &settings, nil
}

// SaveBackupSettings 覆盖写入单例备份设置。
func SaveBackupSettings(ctx context.Context, settings *models.BackupSettings) error {
	if common.DB == nil {
		return errors.New("save backup settings: nil db")
	}
	if settings == nil {
		return errors.New("save backup settings: missing settings")
	}
	settings.ID = 1
	settings.BackupPath = strings.TrimSpace(settings.BackupPath)
	if err := common.DB.WithContext(ctx).Save(settings).Error; err != nil {
		return fmt.Errorf("save backup settings: %w", err)
	}
	return nil
}
