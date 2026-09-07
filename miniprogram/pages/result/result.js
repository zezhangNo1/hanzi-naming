/**
 * result 页 — 生成结果列表（B2 最小验证版）
 *
 * 职责：
 * 1. 进入后按 jobId 轮询 generate.poll（1.5s 间隔，25s 超时），渲染候选列表；
 * 2. 展示降级标记（degraded）与剩余额度（free/ad/paid）；
 * 3. 「换一批」：从 storage 取 lastNamingInput，batch+1 重新 create + 轮询；
 * 4. 埋点：generate_success / generate_fail。
 *
 * B4 待接入：风格筛选、tag-pill 标签、解锁卡组件、收藏/排除手势。
 */
'use strict';

const request = require('../../utils/request');
const tracker = require('../../utils/tracker');

/** 轮询参数 */
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 25000;

/** 风格 key -> 展示名（与 style-chips 组件 STYLE_LIST 一致） */
const STYLE_LABELS = {
  '古风雅致': '古风雅致',
  '温柔诗意': '温柔诗意',
  '阳光开朗': '阳光开朗',
  '英气飒爽': '英气飒爽',
  '中性大方': '中性大方',
  '诗意江南': '诗意江南',
  '典籍感': '典籍感',
  '自然清新': '自然清新'
};

/** 平仄 -> 展示字 */
const TONE_LABELS = { ping: '平', ze: '仄' };

Page({
  data: {
    jobId: '',
    loading: true,          // 轮询中
    loadFailed: false,      // 轮询超时/失败（展示重试）
    degraded: false,        // 降级标记（3001）
    candidates: [],         // 渲染用候选列表
    quota: { freeLeft: 0, adLeft: 0, paidLeft: 0 },
    regenerating: false
  },

  /** 轮询句柄（不放进 data） */
  _pollTimer: null,
  _pollStart: 0,

  onLoad(options) {
    const jobId = (options && options.jobId) ? decodeURIComponent(options.jobId) : '';
    if (!jobId) {
      wx.showToast({ title: '缺少任务参数', icon: 'none' });
      this.setData({ loading: false, loadFailed: true });
      return;
    }
    this.setData({ jobId: jobId });
    this._pollStart = Date.now();
    this._startPolling();
  },

  onUnload() {
    this._stopPolling();
  },

  /* ---------------- 轮询 ---------------- */

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setTimeout(() => this._pollOnce(), POLL_INTERVAL_MS);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async _pollOnce() {
    try {
      const res = await request.call('generate', 'poll', { jobId: this.data.jobId });
      if (res.status === 'done') {
        const latency = Date.now() - this._pollStart;
        this._applyResult(res);
        tracker.track('generate_success', {
          jobId: this.data.jobId,
          latency_ms: latency,
          degraded: !!res.degraded,
          source: 'free'
        });
        return; // 轮询结束
      }
      if (res.status === 'failed') {
        this._stopPolling();
        this.setData({ loading: false, loadFailed: true });
        tracker.track('generate_fail', { stage: 'generate', code: 3002 });
        return;
      }
      // pending：继续轮询（B2 降级引擎同步完成，此分支理论上少走）
      if (Date.now() - this._pollStart > POLL_TIMEOUT_MS) {
        this._stopPolling();
        this.setData({ loading: false, loadFailed: true });
        tracker.track('generate_fail', { stage: 'poll_timeout', code: -1 });
        return;
      }
      this._startPolling();
    } catch (err) {
      this._stopPolling();
      this.setData({ loading: false, loadFailed: true });
      tracker.track('generate_fail', { stage: 'poll', code: (err && err.code) || -1 });
    }
  },

  /** 手动重试（超时/失败态） */
  onRetryTap() {
    this.setData({ loading: true, loadFailed: false });
    this._pollStart = Date.now();
    this._startPolling();
  },

  /* ---------------- 渲染组装 ---------------- */

  _applyResult(res) {
    const list = (res.candidates || []).map((c, idx) => {
      const pinyin = Array.isArray(c.pinyin) ? c.pinyin.join(' ') : (c.pinyin || '');
      const tones = Array.isArray(c.tones)
        ? c.tones.map((t) => TONE_LABELS[t] || '').join(' ')
        : '';
      const meaning = c.meaning
        || (Array.isArray(c.chars) ? c.chars.map((ch) => ch.char + '：' + (ch.meaning || '')).join('；') : '');
      const strokes = Array.isArray(c.chars)
        ? c.chars.reduce((sum, ch) => sum + ((ch && ch.strokes) || 0), 0)
        : 0;
      return {
        id: (c._id || '') + '_' + idx, // 列表 key（_id 可能缺省）
        name: c.name || '',
        pinyin: pinyin,
        tones: tones,
        meaning: meaning,
        strokes: strokes,
        style: STYLE_LABELS[c.style] || ''
      };
    });
    this.setData({
      loading: false,
      loadFailed: false,
      degraded: !!res.degraded,
      candidates: list,
      quota: res.quota || this.data.quota
    });
  },

  /* ---------------- 换一批 ---------------- */

  async onRegenerate() {
    if (this.data.regenerating || this.data.loading) return;
    let payload;
    try { payload = wx.getStorageSync('lastNamingInput'); } catch (e) { payload = null; }
    if (!payload || !payload.surname) {
      wx.showToast({ title: '请从首页重新发起生成', icon: 'none' });
      return;
    }
    const next = Object.assign({}, payload, { batch: ((payload.batch || 1) + 1) });
    this.setData({ regenerating: true });
    try {
      const res = await request.call('generate', 'create', next);
      try { wx.setStorageSync('lastNamingInput', next); } catch (e) { /* 忽略 */ }
      this._pollStart = Date.now();
      this.setData({
        jobId: res.jobId,
        candidates: [],
        loading: true,
        loadFailed: false,
        degraded: false
      });
      this._startPolling();
    } catch (err) {
      if (err && err.code === request.ERR.QUOTA_EXCEEDED) {
        // 2001：免费额度用完（解锁卡 B4 接入，B2 最小提示）
        wx.showToast({ title: '今日免费次数已用完', icon: 'none' });
      }
      // 其余错误码 toast 已由 request.js 统一处理
    } finally {
      this.setData({ regenerating: false });
    }
  },

  /** 返回首页调整条件 */
  onBackToEdit() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
