/**
 * 「默认随机展示」的判定。
 *
 * 视频与 JAV 作品列表共用一套随机模式（`sort=random&seed=N`，不支持分页），
 * 设置里的 `default_random`（缺省开启）决定**首次进入某个模块**时是否直接进随机。
 *
 * 判定只看入口状态：URL 已经带了随机、带了临时排序，或不在第一页，说明这是用户
 * 自己走过的状态，不能再覆盖。至于「每个模块只判定一次」由调用方用 ref 保证 ——
 * 否则用户手动退出随机后，URL 同步回 `?page=1` 会被这里再次拽回随机。
 */
export function shouldApplyDefaultRandom(entry, enabled = true) {
  if (!enabled) return false
  if (!entry) return false
  if (entry.random) return false
  if (entry.tempSort) return false
  const page = Number(entry.page)
  return !Number.isFinite(page) || page <= 1
}