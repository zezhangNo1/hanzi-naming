/**
 * folder 页 — 选名夹（INTENT-T09）
 *
 * 职责：
 * 1. onShow 拉取 user.listFolder（从详情页收藏/取消返回后自动刷新）；
 * 2. 收藏卡列表：名字/拼音/平仄/风格/重名度标签/一句话备注，点击卡进命名检测报告；
 * 3. 取消收藏：乐观移除 + 失败回滚（数据以服务端为准）；
 * 4. 空态引导回首页起名；下拉刷新；
 * 5. 埋点：folder_view / folder_uncollect。
 *
 * 合规：全部维度标签化表述（无分值、无预测性文案）；
 * 名字/释义过客户端红线兜底扫描，命中不展示原文。
 */
'use strict';

const request = require('../../utils/request');
const tracker = require('../../utils/tracker');
var filterClient = require('../../utils/filter-client');

/** 平仄 -> 展示字（与结果页同口径） */
const TONE_LABELS = { ping: '平', ze: '仄' };
/** 重名度标签（标签化，禁数值） */
const DUP_LABELS = { low: '重名较少', mid: '重名中等', high: '重名较高' };

Page({
  data: {
    loading: true,
    loadFailed: false,
    list: []          // [{ cid, name, pinyin, tones, style, meaning, note, dup }]
  },

  /** 行级操作锁（cid -> true），防连点重复请求 */
  _busy: {},

  onShow() {
    tracker.track('folder_view', {});
    this._fetch();
  },

  onPullDownRefresh() {
    this._fetch().then(() => wx.stopPullDownRefresh());
  },

  /**
   * 读接口 + 已知平台抖动自动重试：-504002（0 code exit unexpected）是免费环境
   * Node16 冷启动偶发进程崩溃（交接简报已知问题，与代码无关，重试即恢复）。
   * listFolder 为只读操作，重试安全；仅对这一类错误重试一次，其余原样抛出。
   */
  _callListFolder() {
    const req = () => request.call('user', 'listFolder', { limit: 50 });
    return req().catch((err) => {
      if (err && err.code === request.NETWORK_ERROR_CODE
        && /-504002|code exit unexpected/i.test(err.msg || '')) {
        console.warn('[folder] 命中云函数冷启动抖动（-504002），自动重试一次');
        return req();
      }
      throw err;
    });
  },

  async _fetch() {
    this.setData({ loading: true, loadFailed: false });
    try {
      const res = await this._callListFolder();
      this._applyResult(res);
    } catch (err) {
      console.error('[folder] listFolder 失败：', err);
      this.setData({ loading: false, loadFailed: true });
    }
  },

  /** 组装渲染数据（candidate 字段 schema 见 generate 的 buildCandidate） */
  _applyResult(res) {
    const rows = (res && res.list) || [];
    const list = [];
    for (const row of rows) {
      const c = row.candidate || {};
      const rawName = c.name || '';
      const rawMeaning = c.meaning || '';
      // 客户端兜底扫描（与结果页同口径）：红线词命中 → 该行不展示
      if (filterClient.scanRedline(rawName + rawMeaning)) continue;
      const pinyin = Array.isArray(c.pinyin) ? c.pinyin.join(' ') : '';
      const tones = Array.isArray(c.tones)
        ? c.tones.map((t) => TONE_LABELS[t] || '').join(' ')
        : '';
      const checks = c.checks || {};
      list.push({
        cid: row.candidateId || '',
        name: rawName,
        pinyin: pinyin,
        tones: tones,
        style: c.style || '',
        meaning: rawMeaning,
        note: row.note || '',
        dup: DUP_LABELS[checks.duplicateLevel] || ''
      });
    }
    this.setData({ loading: false, loadFailed: false, list: list });
  },

  onRetryTap() {
    this._fetch();
  },

  /** 点击收藏卡 → 命名检测报告 */
  onCardTap(e) {
    const cid = e.currentTarget.dataset.cid;
    if (!cid) return;
    wx.navigateTo({
      url: '/pages/detail/detail?candidateId=' + encodeURIComponent(cid)
    });
  },

  /** 取消收藏：乐观移除 + 失败回滚（INTENT-T09 弱网验收项） */
  async onUncollectTap(e) {
    const cid = e.currentTarget.dataset.cid;
    if (!cid || this._busy[cid]) return;
    const idx = this.data.list.findIndex((x) => x.cid === cid);
    if (idx < 0) return;
    const removed = this.data.list[idx];
    this._busy[cid] = true;
    this.setData({ list: this.data.list.filter((x) => x.cid !== cid) });
    try {
      await request.call('user', 'uncollect', { candidateId: cid });
      wx.showToast({ title: '已移出选名夹', icon: 'none' });
      tracker.track('folder_uncollect', { candidateId: cid });
    } catch (err) {
      // 失败回滚：还原原位置（错误 toast 已由 request.js 统一处理）
      const rolled = this.data.list.slice();
      rolled.splice(Math.min(idx, rolled.length), 0, removed);
      this.setData({ list: rolled });
    } finally {
      this._busy[cid] = false;
    }
  },

  /** 空态引导：回首页起名 */
  onGoNamingTap() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
