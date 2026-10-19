import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { useStore } = await import('../src/store.js')

/** 先把搜索框填上关键词，跑完用例再复位，避免污染其它用例。 */
function withSearch(run) {
  useStore.setState({ searchInput: '关键词', searchTerm: '关键词' })
  try {
    return run()
  } finally {
    useStore.setState({ searchInput: '', searchTerm: '' })
  }
}

test('视频模式功能栏「清空」会一并清空搜索框', () => {
  withSearch(() => {
    const assertSearchCleared = () => {
      const state = useStore.getState()
      assert.equal(state.searchInput, '')
      assert.equal(state.searchTerm, '')
    }
    useStore.getState().clearFilters()
    assertSearchCleared()
  })
})

test('JAV 作品页功能栏「清空」会一并清空搜索框', () => {
  withSearch(() => {
    useStore.getState().clearJavFilters()
    const state = useStore.getState()
    assert.equal(state.searchInput, '')
    assert.equal(state.searchTerm, '')
  })
})

test('JAV 女优页功能栏「清空」会一并清空搜索框', () => {
  withSearch(() => {
    useStore.getState().resetIdolControls()
    const state = useStore.getState()
    assert.equal(state.searchInput, '')
    assert.equal(state.searchTerm, '')
  })
})

test('resetSearch 同时复位输入框与生效值', () => {
  withSearch(() => {
    useStore.getState().resetSearch()
    const state = useStore.getState()
    assert.equal(state.searchInput, '')
    assert.equal(state.searchTerm, '')
  })
})
