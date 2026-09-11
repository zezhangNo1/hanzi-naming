/**
 * detail 页 — 命名检测报告（INTENT-T08）
 *
 * 职责：
 * 1. onLoad 取 candidateId → generate.getDetail 拉取候选全文 + 同风格替代 + 收藏态；
 * 2. 六维报告渲染：字义/音律(平仄图)/典籍出处/谐音检测/书写笔画/重名度参考；
 * 3. 收藏切换（user.collect/uncollect，含 collect 埋点）；
 * 4. 反馈入口（report-feedback 组件 → user.feedback）；
 * 5. 埋点：candidate_view{candidateId}。
 *
 * 合规：标题固定「命名检测报告」；全部维度为客观可校验信息；任何量化仅标签化表述；
 * 全页文案对照 redline-ui 词表自查零命中（不含任何命理玄学类用语）。
 */
'use strict';

const request = require('../../utils/request');
const tracker = require('../../utils/tracker');
var filterClient = require('../../utils/filter-client');

/** 重名度标签 → 展示文案（标签化，禁数值） */
const DUP_LABELS = { low: '低', mid: '中', high: '高' };
const DUP_DESC = {
  low: '用字相对少见，重名概率较低',
  mid: '含常用字，重名概率中等',
  high: '含高频用字，重名概率较高'
};

Page({
  data: {
    candidateId: '',
    loading: true,
    loadFailed: false,
    // 名字头区
    name: '',
    pinyin: [],          // 逐字拼音（传 tone-chart）
    tones: [],           // 逐字平仄（传 tone-chart）
    pinyinText: '',
    styleLabel: '',
    meaning: '',
    // 六维
    charCards: [],       // [{ key, char, strokes, meaning, isSurname }]
    quote: null,
    checks: null,
    homophoneDetail: '',
    alternatives: [],
    writeCost: 0,
    strokesText: '',
    duplicateLabel: '',
    duplicateCls: 'mid',
    duplicateDesc: '',
    // 操作区
    collected: false,
    collectBusy: false,
    reportFlagged: false
  },

  onLoad(options) {
    const candidateId = (options && options.candidateId) ? decodeURIComponent(options.candidateId) : '';
    if (!candidateId) {
      wx.showToast({ title: '缺少参数', icon: 'none' });
      this.setData({ loading: false, loadFailed: true });
      return;
    }
    this.setData({ candidateId: candidateId });
    tracker.track('candidate_view', { candidateId: candidateId });
    this._fetch();
  },

  async _fetch() {
    this.setData({ loading: true, loadFailed: false });
    try {
      const res = await request.call('generate', 'getDetail', {
        candidateId: this.data.candidateId
      });
      this._applyResult(res);
    } catch (err) {
      console.error('[detail] getDetail 失败：', err);
      this.setData({ loading: false, loadFailed: true });
    }
  },

  /** 组装六维渲染数据（candidate 字段 schema 见 buildCandidate） */
  _applyResult(res) {
    const c = (res && res.candidate) || {};
    const checks = c.checks || {};
    const rawMeaning = c.meaning || '';

    // 客户端兜底扫描（与结果页同口径）：名字/释义命中红线词 → 不展示原文
    if (filterClient.scanRedline((c.name || '') + rawMeaning)) {
      this.setData({ loading: false, loadFailed: true });
      wx.showToast({ title: '内容暂不可展示', icon: 'none' });
      return;
    }

    const chars = Array.isArray(c.chars) ? c.chars : [];
    const charCards = chars.map((ch, i) => ({
      key: i,
      char: (ch && ch.char) || '',
      strokes: (ch && ch.strokes) || 0,
      meaning: (ch && ch.meaning) || '',
      isSurname: i === 0
    }));
    const pinyin = Array.isArray(c.pinyin) ? c.pinyin : [];
    const tones = Array.isArray(c.tones) ? c.tones : [];
    const strokesText = charCards.map((ch) => ch.char + ' ' + ch.strokes + ' 画').join(' · ');

    this.setData({
      loading: false,
      loadFailed: false,
      name: c.name || '',
      pinyin: pinyin,
      tones: tones,
      pinyinText: pinyin.join(' '),
      styleLabel: c.style || '',
      meaning: rawMeaning,
      charCards: charCards,
      quote: c.quote || null,
      checks: checks,
      homophoneDetail: res.homophoneDetail || '',
      alternatives: res.alternatives || [],
      writeCost: typeof checks.writeCost === 'number' ? checks.writeCost : 0,
      strokesText: strokesText,
      duplicateLabel: DUP_LABELS[checks.duplicateLevel] || '中',
      duplicateCls: ['low', 'mid', 'high'].indexOf(checks.duplicateLevel) !== -1 ? checks.duplicateLevel : 'mid',
      duplicateDesc: DUP_DESC[checks.duplicateLevel] || DUP_DESC.mid,
      collected: !!res.collected
    });
  },

  onRetryTap() {
    this._fetch();
  },

  onBackTap() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  /* ---------------- 收藏切换 ---------------- */

  async onCollectTap() {
    if (this.data.collectBusy || this.data.loading) return;
    const candidateId = this.data.candidateId;
    this.setData({ collectBusy: true });
    try {
      if (this.data.collected) {
        await request.call('user', 'uncollect', { candidateId: candidateId });
        this.setData({ collected: false });
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      } else {
        await request.call('user', 'collect', { candidateId: candidateId });
        this.setData({ collected: true });
        wx.showToast({ title: '已收藏', icon: 'none' });
        // collect 埋点（WNKU 口径）：batch_index 取最近一次生成输入的批次
        let batch = 1;
        try {
          const last = wx.getStorageSync('lastNamingInput');
          if (last && last.batch) batch = last.batch;
        } catch (e) { /* 忽略 */ }
        tracker.track('collect', { candidateId: candidateId, batch_index: batch });
      }
    } catch (err) {
      // 失败 toast 已由 request.js 统一处理，收藏态不变
      console.error('[detail] 收藏操作失败：', err);
    } finally {
      this.setData({ collectBusy: false });
    }
  },

  /** report-feedback 提交成功回调：置本地 reportFlagged */
  onFlagged() {
    this.setData({ reportFlagged: true });
  }
});
