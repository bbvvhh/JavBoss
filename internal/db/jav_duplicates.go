package db

import (
	"context"
	"fmt"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SearchJavDuplicates lists JAV works that resolve to more than one active video
// file. Each active video_location counts as one file, so a JAV work with a
// duplicate count above one is considered a duplicate. Whitelisted works are
// excluded.
func SearchJavDuplicates(ctx context.Context, search, sort string, limit, offset int, directoryIDs []int64) ([]models.Jav, int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	search = strings.TrimSpace(search)

	filtered := buildJavDuplicateFilter(ctx, search, directoryIDs)

	countQuery := buildJavDuplicateFilter(ctx, search, directoryIDs).Select("DISTINCT jav.id")
	var total int64
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count jav duplicates: %w", err)
	}

	order := duplicateCountSQL(directoryIDs) + " DESC, jav.code ASC, jav.id ASC"
	switch strings.ToLower(strings.TrimSpace(sort)) {
	case "code", "code_asc":
		order = "jav.code ASC, jav.id ASC"
	case "code_desc":
		order = "jav.code DESC, jav.id DESC"
	case "recent":
		order = "jav.created_at DESC, jav.id DESC"
	}

	var items []models.Jav
	query := filtered.
		Preload("Studio").
		Preload("Idols").
		Preload("Series").
		Order(order).
		Limit(limit).
		Offset(offset)
	if err := query.Find(&items).Error; err != nil {
		return nil, 0, fmt.Errorf("list jav duplicates: %w", err)
	}
	if err := attachJavLocationVideos(ctx, items, directoryIDs); err != nil {
		return nil, 0, err
	}
	if err := attachVisibleJavTags(ctx, items); err != nil {
		return nil, 0, err
	}
	if err := attachJavFavoriteCounts(ctx, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func buildJavDuplicateFilter(ctx context.Context, search string, directoryIDs []int64) *gorm.DB {
	q := common.DB.WithContext(ctx).Model(&models.Jav{})

	validLocation := common.DB.WithContext(ctx).
		Table("video_location vl").
		Select("1").
		Joins("JOIN directory d ON d.id = vl.directory_id").
		Where("vl.jav_id = jav.id").
		Where(activeLocationWhereSQL("vl", "d"))
	validLocation = applyDirectoryFilter(validLocation, "vl", directoryIDs)
	q = q.Where("EXISTS (?)", validLocation)

	countSubquery := common.DB.WithContext(ctx).
		Table("video_location vl").
		Select("COUNT(*)").
		Joins("JOIN directory d ON d.id = vl.directory_id").
		Where("vl.jav_id = jav.id").
		Where(activeLocationWhereSQL("vl", "d"))
	countSubquery = applyDirectoryFilter(countSubquery, "vl", directoryIDs)
	q = q.Where("(?) > 1", countSubquery)

	q = q.Where("NOT EXISTS (SELECT 1 FROM jav_duplicate_whitelist jdw WHERE jdw.jav_id = jav.id)")

	if search != "" {
		like := fmt.Sprintf("%%%s%%", search)
		q = q.Where("code LIKE ? OR title LIKE ?", like, like)
	}
	return q
}

func duplicateCountSQL(directoryIDs []int64) string {
	return "(SELECT COUNT(*) FROM video_location vl JOIN directory d ON d.id = vl.directory_id WHERE vl.jav_id = jav.id AND " + activeLocationWhereSQL("vl", "d") + directoryFilterSQL("vl", directoryIDs) + ")"
}

// ListJavDuplicateWhitelist returns every whitelisted JAV work.
func ListJavDuplicateWhitelist(ctx context.Context) ([]models.JavDuplicateWhitelist, error) {
	var items []models.JavDuplicateWhitelist
	if err := common.DB.WithContext(ctx).
		Order("code ASC, id ASC").
		Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list jav duplicate whitelist: %w", err)
	}
	return items, nil
}

// AddJavDuplicateWhitelist whitelists the given JAV works. Already whitelisted
// works are left unchanged.
func AddJavDuplicateWhitelist(ctx context.Context, javIDs []int64) (int64, error) {
	ids := uniqueInt64s(javIDs)
	if len(ids) == 0 {
		return 0, nil
	}

	var javs []models.Jav
	if err := common.DB.WithContext(ctx).Select("id", "code").Where("id IN ?", ids).Find(&javs).Error; err != nil {
		return 0, fmt.Errorf("load jav for duplicate whitelist: %w", err)
	}
	if len(javs) == 0 {
		return 0, nil
	}

	rows := make([]models.JavDuplicateWhitelist, 0, len(javs))
	for _, item := range javs {
		rows = append(rows, models.JavDuplicateWhitelist{JavID: item.ID, Code: item.Code})
	}
	result := common.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "jav_id"}},
		DoNothing: true,
	}).Create(&rows)
	if result.Error != nil {
		return 0, fmt.Errorf("add jav duplicate whitelist: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// RemoveJavDuplicateWhitelist removes the given JAV works from the whitelist.
func RemoveJavDuplicateWhitelist(ctx context.Context, javIDs []int64) (int64, error) {
	ids := uniqueInt64s(javIDs)
	if len(ids) == 0 {
		return 0, nil
	}
	result := common.DB.WithContext(ctx).
		Where("jav_id IN ?", ids).
		Delete(&models.JavDuplicateWhitelist{})
	if result.Error != nil {
		return 0, fmt.Errorf("remove jav duplicate whitelist: %w", result.Error)
	}
	return result.RowsAffected, nil
}
