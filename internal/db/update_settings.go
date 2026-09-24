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

// GetUpdateSettings 返回程序更新设置；表里没有记录时返回空设置的默认值。
func GetUpdateSettings(ctx context.Context) (*models.UpdateSettings, error) {
	if common.DB == nil {
		return nil, errors.New("get update settings: nil db")
	}
	var settings models.UpdateSettings
	err := common.DB.WithContext(ctx).First(&settings, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.UpdateSettings{ID: 1}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get update settings: %w", err)
	}
	return &settings, nil
}

// SaveUpdateSettings 覆盖写入单例程序更新设置。
func SaveUpdateSettings(ctx context.Context, settings *models.UpdateSettings) error {
	if common.DB == nil {
		return errors.New("save update settings: nil db")
	}
	if settings == nil {
		return errors.New("save update settings: missing settings")
	}
	settings.ID = 1
	settings.UpdatePath = strings.TrimSpace(settings.UpdatePath)
	if err := common.DB.WithContext(ctx).Save(settings).Error; err != nil {
		return fmt.Errorf("save update settings: %w", err)
	}
	return nil
}
