/**
 * index 页 — 首页输入（T03 / INTENT-T03 完整实现）
 *
 * 必填最小集 3 项：姓氏（1 字校验）、性别（单选）、风格（可跳过 = 不限）。
 * 渐进折叠卡收纳：字辈 / 避讳字 / 寄语 / 方言 chips（粤/川渝可用，吴/闽/客置灰）、
 * 生辰（展示但标注「暂未开放」，授权弹窗组件 B4 接入）。
 * 提交：call('generate','create') 成功后携 jobId 跳结果页；埋点 enter / input_submit。
 */
'use strict';

const request = require('../../utils/request');
const tracker = require('../../utils/tracker');

/** 姓氏校验：1 个汉字（含扩展区） */
const SURNAME_REG = /^[\u3400-\u9FFF\uF900-\uFAFF]$/;

/** 方言 chips：粤/川渝可用；吴/闽/客置灰（即将支持） */
const DIALECT_CHIPS = [
  { key: 'yue', label: '粤语', enabled: true },
  { key: 'xic', label: '川渝', enabled: true },
  { key: 'wu', label: '吴语', enabled: false },
  { key: 'min', label: '闽语', enabled: false },
  { key: 'hak', label: '客家话', enabled: false }
];

Page({
  data: {
    // 表单
    surname: '',
    gender: '',
    styles: [],
    // 渐进卡内容
    generationChar: '',
    avoidCharsInput: '',
    wishes: '',
    dialects: [],
    /** 方言选中态映射（WXML 不支持函数调用，查表用） */
    dialectMap: {},
    dialectChips: DIALECT_CHIPS,
    // 状态
    submitting: false,
    showQuotaCard: false,
    surnameError: ''
  },

  onLoad(options) {
    // B2 验证期临时开启采集；B4 隐私授权弹窗同意后由 app 层统一 setConsent
    tracker.setConsent(true);
    tracker.track('enter', { scene: (options && options.scene) || 'default' });
  },

  /* ---------------- 表单事件 ---------------- */

  onSurnameInput(e) {
    const value = (e.detail.value || '').trim();
    this.setData({
      surname: value,
      surnameError: ''
    });
  },

  /** 失焦归一化：多个字时取第一个字（输入期不做截断，避免打断输入法拼音组合） */
  onSurnameBlur(e) {
    const chars = Array.from((e.detail.value || '').trim());
    this.setData({ surname: chars[0] || '' });
  },

  onGenderTap(e) {
    this.setData({ gender: e.currentTarget.dataset.gender });
  },

  onStylesChange(e) {
    this.setData({ styles: e.detail.value });
  },

  onGenerationCharInput(e) {
    // 输入期不截断（避免打断拼音组合），失焦/提交时归一化
    this.setData({ generationChar: (e.detail.value || '').trim() });
  },

  /** 失焦归一化：仅取第一个字 */
  onGenerationCharBlur(e) {
    const first = Array.from((e.detail.value || '').trim())[0] || '';
    this.setData({ generationChar: first });
  },

  onAvoidCharsInput(e) {
    this.setData({ avoidCharsInput: e.detail.value || '' });
  },

  onWishesInput(e) {
    this.setData({ wishes: e.detail.value || '' });
  },

  /** 失焦归一化：截断到 50 字 */
  onWishesBlur(e) {
    this.setData({ wishes: (e.detail.value || '').slice(0, 50) });
  },

  onDialectTap(e) {
    const key = e.currentTarget.dataset.key;
    const chip = DIALECT_CHIPS.find((d) => d.key === key);
    if (!chip || !chip.enabled) return; // 置灰项不可点
    const current = this.data.dialects.slice();
    const idx = current.indexOf(key);
    if (idx === -1) current.push(key); else current.splice(idx, 1);
    const map = {};
    current.forEach((k) => { map[k] = true; });
    this.setData({ dialects: current, dialectMap: map });
  },

  /** 生辰：B2 仅展示「暂未开放」，不做授权弹窗（B4 接入 user.setBirthConsent） */
  onBirthItemTap() {
    wx.showToast({ title: '生辰输入暂未开放', icon: 'none' });
  },

  /* ---------------- 提交 ---------------- */

  async onSubmit() {
    if (this.data.submitting) return;

    // 1. 姓氏校验（1 字）
    const surname = this.data.surname.trim();
    if (!SURNAME_REG.test(surname)) {
      this.setData({ surnameError: '请输入 1 个汉字的姓氏' });
      return;
    }
    // 2. 性别必选
    if (!this.data.gender) {
      wx.showToast({ title: '请选择宝宝性别', icon: 'none' });
      return;
    }

    // constraints 序列化（对齐 name_jobs.constraints schema）
    const avoidChars = Array.from(this.data.avoidCharsInput.replace(/[\s,，、]/g, ''));
    // 字辈未失焦时在提交侧归一化（仅取首字）
    const genChar = Array.from(this.data.generationChar.trim())[0] || '';
    const constraints = {
      birth: null, // B2 生辰未开放，恒 null
      generationChar: genChar,
      avoidChars: avoidChars,
      wishes: this.data.wishes.slice(0, 50),
      dialects: this.data.dialects.slice()
    };

    // 埋点：input_submit
    tracker.track('input_submit', {
      has_styles: this.data.styles.length > 0,
      has_constraints: constraints.generationChar !== '' || avoidChars.length > 0 || constraints.wishes !== '' || constraints.dialects.length > 0
    });

    const payload = {
      surname: surname,
      gender: this.data.gender,
      styles: this.data.styles,
      constraints: constraints,
      source: 'free',
      batch: 1
    };

    // 供结果页「换一批」复用（storage 方案，B4 可改 eventChannel）
    try { wx.setStorageSync('lastNamingInput', payload); } catch (e) { /* storage 异常不阻断 */ }

    this.setData({ submitting: true, showQuotaCard: false });
    try {
      const res = await request.call('generate', 'create', payload);
      wx.navigateTo({
        url: '/pages/result/result?jobId=' + encodeURIComponent(res.jobId)
      });
    } catch (err) {
      if (err && err.code === request.ERR.QUOTA_EXCEEDED) {
        // 2001：展示解锁卡（B4 完整解锁卡组件，B2 最小面板）
        this.setData({ showQuotaCard: true });
      }
      // 其余错误码 toast 已由 request.js 统一处理
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 解锁卡关闭（B2 占位：真实解锁卡 B4 商业化批次实现） */
  onQuotaCardClose() {
    this.setData({ showQuotaCard: false });
  }
});
