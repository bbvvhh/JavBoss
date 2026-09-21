import TagManagerPage from '@/components/settings/TagManagerPage'

/** JAV 标签：复用统一的标签管理器（jav 模式，刮削标签只读 + 自动整理分类）。 */
export default function JavTagPage({ onClose }) {
  return <TagManagerPage mode="jav" onClose={onClose} />
}
