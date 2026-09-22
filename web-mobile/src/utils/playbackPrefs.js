import { BOOST_SPEED_CHOICES, DEFAULT_BOOST_SPEED } from '@/utils/boostSpeed'

/**
 * 播放手势的本机偏好。只写 localStorage，不碰服务端配置，也不碰任何视频文件。
 *
 * 约定与 utils/progress.js 一致：存储不可用（Safari 隐私模式下访问 localStorage
 * 直接抛异常）时全部退化为默认值，不抛错、不阻塞播放。
 */
const BOOST_ENABLED_KEY = 'javboss-mobile:boost-enabled'
const BOOST_SPEED_KEY = 'javboss-mobile:boost-speed'

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 长按倍速开关。默认开启。 */
export function isBoostEnabled() {
  const store = storage()
  if (!store) return true
  try {
    return store.getItem(BOOST_ENABLED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setBoostEnabled(enabled) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(BOOST_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

/** 长按不动时的倍速。非法值一律回落到默认档。 */
export function readBoostSpeed() {
  const store = storage()
  if (!store) return DEFAULT_BOOST_SPEED
  try {
    const value = Number(store.getItem(BOOST_SPEED_KEY))
    return BOOST_SPEED_CHOICES.includes(value) ? value : DEFAULT_BOOST_SPEED
  } catch {
    return DEFAULT_BOOST_SPEED
  }
}

export function setBoostSpeed(speed) {
  const store = storage()
  if (!store) return
  const value = Number(speed)
  if (!BOOST_SPEED_CHOICES.includes(value)) return
  try {
    store.setItem(BOOST_SPEED_KEY, String(value))
  } catch {
    /* 忽略 */
  }
}

export const __playbackPrefsInternals = { BOOST_ENABLED_KEY, BOOST_SPEED_KEY }
