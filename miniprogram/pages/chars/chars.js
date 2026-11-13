/**
 * chars 页 — 候选字库（浏览/气质分组/热门冷门）
 *
 * 职责：
 * 1. generate.listChars 拉取候选字看板（603 精选字 + 6 气质组 + 热门度），
 *    storage 缓存（字库变更低频，缓存命中秒开且避开云函数冷启动抖动）；
 * 2. 气质组 chips（全部/清雅/热烈/温柔/书卷/端庄/高远）× 热度筛选（全部/热门/少见）
 *    双维过滤，JS 预计算渲染数据（WXML 不做函数绑定）；
 * 3. 字卡点击展开详情（拼音/笔画/热度标签/所属气质组/意象标签/完整释义）；
 * 4. 下拉刷新清缓存重拉；埋点 chars_view { group, freq }。
 *
 * 合规：释义为字库既有数据（已过红线校验）；页面不涉及生成与预测性表述。
 */
'use strict';

const request = require('../../utils/request');
const tracker = require('../../utils/tracker');

/** 看板缓存版本（字库数据更新时递增使本地缓存失效；v3：v0.5 池 +81 热门字） */
const BOARD_CACHE_VERSION = 'v3-20261113';
const BOARD_CACHE_KEY = 'charsBoardCache';

/** 热度 → 展示标签 */
const FREQ_LABELS = { high: '热门', mid: '常用', low: '少见' };
/** 性别亲和 → 展示标签 */
const GENDER_LABELS = { m: '男宝', f: '女宝', n: '皆宜' };

Page({
  data: {
    loading: true,
    loadFailed: false,
    // 看板原始数据
    groups: [],           // [{ key, label, desc }]
    allChars: [],         // [{ char, pinyin, tone, strokes, meaning, freqLevel, tags, gender, groups }]
    // 过滤器
    groupChips: [],       // [{ key, label, active, count }]
    freqChips: [          // [{ key, label, active }]
      { key: 'all', label: '全部热度' },
      { key: 'high', label: '热门字' },
      { key: 'low', label: '少见字' }
    ],
    activeGroup: 'all',
    activeFreq: 'all',
    // 过滤结果（预计算）
    list: [],
    totalLine: '',
    // 字详情弹层
    selected: null        // { char, pinyin, strokes, freqLabel, genderLabel, groupLabels, tagsText, meaning }
  },

  onLoad() {
    tracker.track('chars_view', {});
    this._load();
  },

  onPullDownRefresh() {
    try { wx.removeStorageSync(BOARD_CACHE_KEY); } catch (e) { /* 忽略 */ }
    this._load().then(() => wx.stopPullDownRefresh());
  },

  /** 只读接口走 callSafe（冷启动抖动自动重试，见 request.js） */
  _callListChars() {
    return request.callSafe('generate', 'listChars', {});
  },

  async _load() {
    this.setData({ loading: true, loadFailed: false });
    // 缓存命中：秒开
    try {
      const cached = wx.getStorageSync(BOARD_CACHE_KEY);
      if (cached && cached.v === BOARD_CACHE_VERSION && cached.data && cached.data.chars) {
        this._applyBoard(cached.data);
        return;
      }
    } catch (e) { /* storage 异常不阻断，走网络 */ }

    try {
      const board = await this._callListChars();
      try {
        wx.setStorageSync(BOARD_CACHE_KEY, { v: BOARD_CACHE_VERSION, data: board });
      } catch (e) { /* 缓存失败不影响展示 */ }
      this._applyBoard(board);
    } catch (err) {
      console.error('[chars] listChars 失败：', err);
      this.setData({ loading: false, loadFailed: true });
    }
  },

  /** 挂载看板并预计算分组 chips 计数 */
  _applyBoard(board) {
    const groups = board.groups || [];
    const allChars = board.chars || [];
    const groupChips = [{ key: 'all', label: '全部', count: allChars.length }].concat(
      groups.map((g) => ({
        key: g.key,
        label: g.label,
        count: allChars.filter((c) => c.groups.indexOf(g.key) !== -1).length
      }))
    );
    this.setData({
      loading: false,
      loadFailed: false,
      groups: groups,
      allChars: allChars,
      groupChips: groupChips
    });
    this._refilter();
  },

  /** 双维过滤（气质组 × 热度），JS 预计算展示字段（铁律：WXML 不做函数绑定） */
  _refilter() {
    const g = this.data.activeGroup;
    const f = this.data.activeFreq;
    const list = this.data.allChars.filter((c) => {
      if (g !== 'all' && c.groups.indexOf(g) === -1) return false;
      if (f !== 'all' && c.freqLevel !== f) return false;
      return true;
    }).map((c) => ({
      char: c.char,
      pinyin: c.pinyin,
      meaning: c.meaning,
      genderLabel: GENDER_LABELS[c.gender] || '皆宜',
      genderKey: c.gender || 'n'
    }));
    const groupChips = this.data.groupChips.map((chip) =>
      Object.assign({}, chip, { active: chip.key === g }));
    const freqChips = this.data.freqChips.map((chip) =>
      Object.assign({}, chip, { active: chip.key === f }));
    this.setData({
      list: list,
      groupChips: groupChips,
      freqChips: freqChips,
      totalLine: '共 ' + list.length + ' 个字'
    });
  },

  onGroupTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeGroup) return;
    this.setData({ activeGroup: key, selected: null });
    this._refilter();
  },

  onFreqTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeFreq) return;
    this.setData({ activeFreq: key, selected: null });
    this._refilter();
  },

  /** 字卡点击 → 详情弹层（预计算展示文案） */
  onCharTap(e) {
    const ch = e.currentTarget.dataset.char;
    const found = this.data.allChars.find((c) => c.char === ch);
    if (!found) return;
    const groupLabels = (found.groups || []).map((gk) => {
      const g = this.data.groups.find((x) => x.key === gk);
      return g ? g.label : '';
    }).filter(Boolean);
    this.setData({
      selected: {
        char: found.char,
        pinyin: found.pinyin,
        strokes: found.strokes,
        freqLabel: FREQ_LABELS[found.freqLevel] || '常用',
        genderLabel: GENDER_LABELS[found.gender] || '皆宜',
        groupLabels: groupLabels.join(' · '),
        tagsText: (found.tags || []).join(' / '),
        meaning: found.meaning
      }
    });
  },

  onSelectedClose() {
    this.setData({ selected: null });
  },

  onRetryTap() {
    this._load();
  }
});
