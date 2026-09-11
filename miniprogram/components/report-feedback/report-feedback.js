/**
 * report-feedback — 「这条解析不准确」反馈入口（INTENT-T08）
 *
 * 交互：按钮 → 选择问题类型（字义/出处/谐音/其他）→ 可选补充说明 → 调 user.feedback 落库。
 * 成功后置 flagged 并外抛 flagged 事件（父页面写本地 reportFlagged）；失败可重试。
 */
'use strict';

const request = require('../../utils/request');

/** 问题类型选项（顺序即 actionSheet 顺序，key 对齐 user 云函数 FEEDBACK_TYPES） */
const TYPE_OPTIONS = [
  { type: 'meaning', label: '字义解释不准确' },
  { type: 'quote', label: '典籍出处有误' },
  { type: 'homophone', label: '谐音判断有误' },
  { type: 'other', label: '其他问题' }
];

Component({
  properties: {
    /** 候选文档 id（反馈落库关联） */
    candidateId: {
      type: String,
      value: ''
    }
  },

  data: {
    flagged: false,
    busy: false
  },

  methods: {
    async onTap() {
      if (this.data.flagged) {
        wx.showToast({ title: '已收到你的反馈', icon: 'none' });
        return;
      }
      if (this.data.busy) return;
      try {
        // 1. 选问题类型
        const idx = await new Promise((resolve, reject) => {
          wx.showActionSheet({
            itemList: TYPE_OPTIONS.map((o) => o.label),
            success: (res) => resolve(res.tapIndex),
            fail: () => reject({ canceled: true })
          });
        });
        const type = TYPE_OPTIONS[idx] ? TYPE_OPTIONS[idx].type : 'other';

        // 2. 补充说明（可选，取消视为空备注继续提交）
        const comment = await new Promise((resolve) => {
          wx.showModal({
            title: '补充说明（可选）',
            editable: true,
            placeholderText: '说说具体哪里不准确',
            success: (res) => resolve(res.confirm ? (res.content || '') : ''),
            fail: () => resolve('')
          });
        });

        // 3. 落库（user.feedback）
        this.setData({ busy: true });
        await request.call('user', 'feedback', {
          candidateId: this.data.candidateId,
          type: type,
          comment: comment
        });
        this.setData({ flagged: true });
        this.triggerEvent('flagged', { candidateId: this.data.candidateId, type: type });
        wx.showToast({ title: '反馈已提交，感谢你的帮助', icon: 'none' });
      } catch (err) {
        // 用户取消选择不打扰；接口失败由 request.js 统一 toast，保留可重试
        if (!(err && err.canceled)) {
          console.error('[report-feedback] 提交失败：', err);
        }
      } finally {
        this.setData({ busy: false });
      }
    }
  }
});
