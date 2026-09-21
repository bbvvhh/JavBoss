import TagManagerPage from '@/components/settings/TagManagerPage'

/** 视频标签与分类：复用统一的标签管理器（video 模式）。 */
export default function VideoTagPage({ onClose }) {
  return <TagManagerPage mode="video" onClose={onClose} />
}
