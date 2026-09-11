/**
 * quote-card — 典籍出处卡（INTENT-T08 典籍维）
 *
 * 输入：quote（{ author, title, sentence } | null）。
 * 服务端约定：quote 非 null 即已通过语料校验（quote-verify 只回填真实典籍三元组）。
 * null 时优雅降级为「本候选暂无可校验出处」；有值时展示 篇名/作者/原句（可展开全文）。
 */
'use strict';

/** 原句折叠长度（字符） */
const PREVIEW_LEN = 24;

Component({
  properties: {
    /** 典籍三元组或 null */
    quote: {
      type: Object,
      value: null
    }
  },

  data: {
    /** 渲染用三元组（quote 缺字段时兜底空串，禁止透出 null/undefined） */
    author: '',
    title: '',
    sentence: '',
    preview: '',
    /** 原句超过折叠长度才提供展开 */
    expandable: false,
    expanded: false
  },

  observers: {
    quote(q) {
      const author = (q && typeof q.author === 'string') ? q.author : '';
      const title = (q && typeof q.title === 'string') ? q.title : '';
      const sentence = (q && typeof q.sentence === 'string') ? q.sentence : '';
      this.setData({
        author: author,
        title: title,
        sentence: sentence,
        preview: sentence.length > PREVIEW_LEN ? sentence.slice(0, PREVIEW_LEN) + '…' : sentence,
        expandable: sentence.length > PREVIEW_LEN,
        expanded: false
      });
    }
  },

  methods: {
    /** 展开/收起原句全文 */
    onToggleExpand() {
      if (!this.data.expandable) return;
      this.setData({ expanded: !this.data.expanded });
    }
  }
});
