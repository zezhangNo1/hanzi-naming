/**
 * progressive-card — 渐进折叠卡（INTENT-T03）
 *
 * 职责：收纳「字辈/避讳字/寄语/方言/生辰」等可选输入，默认收起、文案中性，
 * 降低完成率干扰（INTENT-T03 第 7 节风险对策）。
 * 内容通过 slot 注入；标题/副标题/禁用态由 properties 控制。
 */
'use strict';

Component({
  properties: {
    /** 折叠卡标题 */
    title: { type: String, value: '' },
    /** 副标题（收起态下的中性提示） */
    subtitle: { type: String, value: '' },
    /** 是否可选填提示（右上角「选填」角标） */
    optional: { type: Boolean, value: true }
  },

  data: {
    expanded: false
  },

  methods: {
    /** 展开/收起切换 */
    onToggle() {
      this.setData({ expanded: !this.data.expanded });
      this.triggerEvent('toggle', { expanded: !this.data.expanded });
    }
  }
});
