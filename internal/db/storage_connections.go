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

// StorageConnectionInput carries the mutable fields of a storage connection.
// A nil field is left untouched on update.
type StorageConnectionInput struct {
	Name     *string
	URL      *string
	Username *string
	Password *string
}

// ListStorageConnections returns every connection with its directory count.
func ListStorageConnections(ctx context.Context) ([]models.StorageConnection, error) {
	var connections []models.StorageConnection
	if err := common.DB.WithContext(ctx).
		Model(&models.StorageConnection{}).
		Select(`storage_connection.*,
			COUNT(directory.id) AS directory_count,
			CASE WHEN storage_connection.password <> '' THEN 1 ELSE 0 END AS has_password`).
		Joins(`LEFT JOIN directory ON directory.connection_id = storage_connection.id
			AND COALESCE(directory.is_delete, 0) = 0`).
		Group("storage_connection.id").
		Order("storage_connection.id").
		Find(&connections).Error; err != nil {
		return nil, fmt.Errorf("list storage connections: %w", err)
	}
	return connections, nil
}

// GetStorageConnection loads one connection by id.
func GetStorageConnection(ctx context.Context, id int64) (*models.StorageConnection, error) {
	if id <= 0 {
		return nil, errors.New("storage connection id must be positive")
	}
	var connection models.StorageConnection
	if err := common.DB.WithContext(ctx).First(&connection, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get storage connection: %w", err)
	}
	return &connection, nil
}

// CreateStorageConnection inserts a new connection.
func CreateStorageConnection(ctx context.Context, input StorageConnectionInput) (*models.StorageConnection, error) {
	name, err := normalizeConnectionName(input.Name)
	if err != nil {
		return nil, err
	}
	endpoint, err := normalizeConnectionURL(input.URL)
	if err != nil {
		return nil, err
	}
	connection := models.StorageConnection{
		Name:     name,
		URL:      endpoint,
		Username: stringOrEmpty(input.Username),
		Password: stringOrEmpty(input.Password),
	}
	if err := common.DB.WithContext(ctx).Create(&connection).Error; err != nil {
		if isUniqueConstraintError(err) {
			return nil, fmt.Errorf("storage connection %q already exists", name)
		}
		return nil, fmt.Errorf("create storage connection: %w", err)
	}
	return &connection, nil
}

// UpdateStorageConnection patches an existing connection.
func UpdateStorageConnection(ctx context.Context, id int64, input StorageConnectionInput) (*models.StorageConnection, error) {
	if id <= 0 {
		return nil, errors.New("storage connection id must be positive")
	}
	var connection models.StorageConnection
	err := common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&connection, id).Error; err != nil {
			return err
		}
		if input.Name != nil {
			name, err := normalizeConnectionName(input.Name)
			if err != nil {
				return err
			}
			connection.Name = name
		}
		if input.URL != nil {
			endpoint, err := normalizeConnectionURL(input.URL)
			if err != nil {
				return err
			}
			connection.URL = endpoint
		}
		if input.Username != nil {
			connection.Username = strings.TrimSpace(*input.Username)
		}
		if input.Password != nil {
			connection.Password = *input.Password
		}
		if err := tx.Save(&connection).Error; err != nil {
			if isUniqueConstraintError(err) {
				return fmt.Errorf("storage connection %q already exists", connection.Name)
			}
			return err
		}
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update storage connection: %w", err)
	}
	return &connection, nil
}

// DeleteStorageConnection removes a connection that no live directory uses.
func DeleteStorageConnection(ctx context.Context, id int64) error {
	if id <= 0 {
		return errors.New("storage connection id must be positive")
	}
	return common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var inUse int64
		if err := tx.Model(&models.Directory{}).
			Where("connection_id = ?", id).
			Where("COALESCE(is_delete, 0) = 0").
			Count(&inUse).Error; err != nil {
			return err
		}
		if inUse > 0 {
			return ErrStorageConnectionInUse
		}
		result := tx.Delete(&models.StorageConnection{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrStorageConnectionNotFound
		}
		return nil
	})
}

// ErrStorageConnectionInUse reports that directories still reference a connection.
var ErrStorageConnectionInUse = errors.New("storage connection is used by one or more directories")

// ErrStorageConnectionNotFound reports a missing connection row.
var ErrStorageConnectionNotFound = errors.New("storage connection not found")

// LoadStorageConnections returns connections keyed by id. Missing ids are absent.
func LoadStorageConnections(ctx context.Context, ids []int64) (map[int64]models.StorageConnection, error) {
	result := make(map[int64]models.StorageConnection, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var connections []models.StorageConnection
	if err := common.DB.WithContext(ctx).Where("id IN ?", ids).Find(&connections).Error; err != nil {
		return nil, fmt.Errorf("load storage connections: %w", err)
	}
	for _, connection := range connections {
		result[connection.ID] = connection
	}
	return result, nil
}

func normalizeConnectionName(raw *string) (string, error) {
	name := strings.TrimSpace(stringOrEmpty(raw))
	if name == "" {
		return "", errors.New("storage connection name is required")
	}
	return name, nil
}

func normalizeConnectionURL(raw *string) (string, error) {
	value := strings.TrimSpace(stringOrEmpty(raw))
	if value == "" {
		return "", errors.New("storage connection URL is required")
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	return strings.TrimSuffix(value, "/"), nil
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "constraint failed")
}
