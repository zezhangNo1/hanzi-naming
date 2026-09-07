/**
 * style-chips — 8 风格多选组件（INTENT-T03）
 *
 * 交互：点击切换选中态；全不选 = 「不限」（由父页面据此生成，组件内不显示"不限"按钮，
 * 但提供 placeholder 提示文案由样式表达选中数量）。
 * 事件：bindchange → e.detail.value = 当前选中风格数组。
 */
'use strict';

/** PRD 定义的 8 风格（与 engine-params.styles.weights 严格一致） */
const STYLE_LIST = [
  { key: '古风雅致', emoji: '卷' },
  { key: '温柔诗意', emoji: '柔' },
  { key: '阳光开朗', emoji: '阳' },
  { key: '英气飒爽', emoji: '飒' },
  { key: '中性大方', emoji: '正' },
  { key: '诗意江南', emoji: '烟' },
  { key: '典籍感', emoji: '典' },
  { key: '自然清新', emoji: '木' }
];

Component({
  properties: {
    /** 当前选中风格数组（外部受控） */
    value: {
      type: Array,
      value: []
    }
  },

  data: {
    styles: STYLE_LIST
  },

  methods: {
    /** 点击 chip：切换选中态并外抛 */
    onToggle(e) {
      const key = e.currentTarget.dataset.key;
      const current = (this.data.value || []).slice();
      const idx = current.indexOf(key);
      if (idx === -1) {
        current.push(key);
      } else {
        current.splice(idx, 1);
      }
      this.setData({ value: current });
      this.triggerEvent('change', { value: current });
    }
  }
});
