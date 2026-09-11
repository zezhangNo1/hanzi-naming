/**
 * homophone-panel — 谐音检测面板（INTENT-T08 谐音维）
 *
 * 输入：checks（candidates.checks，含 homophonePutonghua/homophoneDialect/homophoneEnglish）、
 *       alternatives（同风格替代候选 [{name,pinyin}]，warn 态展示）、
 *       detail（服务端复跑检测的提示文案，可空）。
 * 三段：普通话 / 粤语 / 英语；状态 pass|warn|fail|none（方言未检测恒 none）。
 * warn 态展示同风格替代建议；fail 理论不落库（生成链路已剔除），仅兜底展示。
 */
'use strict';

/** 状态 → 展示文案 */
const STATUS_TEXT = {
  pass: { label: '通过', desc: '未发现敏感谐音' },
  warn: { label: '提示', desc: '与个别敏感读音相近' },
  fail: { label: '风险', desc: '存在敏感谐音' },
  none: { label: '未检测', desc: '方言谐音检测暂未开放' }
};

Component({
  properties: {
    /** candidates.checks 对象 */
    checks: {
      type: Object,
      value: {}
    },
    /** 同风格替代候选（仅 warn 态展示） */
    alternatives: {
      type: Array,
      value: []
    },
    /** 服务端检测提示文案（如「音近「xx」」） */
    detail: {
      type: String,
      value: ''
    }
  },

  data: {
    /** 渲染行：[{ key, name, label, cls, desc, isWarn }] */
    rows: [],
    /** 替代候选展示项：[{ key, name }] */
    altItems: [],
    /** 任一行 warn 才展示替代区 */
    hasWarn: false
  },

  observers: {
    'checks, alternatives, detail': function () {
      this._rebuild();
    }
  },

  lifetimes: {
    attached() {
      this._rebuild();
    }
  },

  methods: {
    _rebuild() {
      const checks = this.data.checks || {};
      // homophoneDialect 为对象 { yue: 'pass'|'warn'|'fail', jyutping }（B3.1 起写实），
      // 旧数据/跳过检测时为 null 或缺 yue → 按「未检测」降级展示
      const dialect = checks.homophoneDialect;
      const dialectStatus = (dialect && dialect.yue === 'pass')
        || (dialect && dialect.yue === 'warn')
        || (dialect && dialect.yue === 'fail') ? dialect.yue : null;
      const def = [
        { key: 'putonghua', name: '普通话', status: checks.homophonePutonghua },
        { key: 'dialect', name: '粤　语', status: dialectStatus,
          extra: (dialect && dialect.jyutping) ? '（粤拼 ' + dialect.jyutping + '）' : '' },
        { key: 'english', name: '英　语', status: checks.homophoneEnglish }
      ];
      let hasWarn = false;
      const rows = def.map((d) => {
        const status = (d.status === 'pass' || d.status === 'warn' || d.status === 'fail')
          ? d.status : 'none';
        const meta = STATUS_TEXT[status];
        const isWarn = status === 'warn';
        if (isWarn) hasWarn = true;
        return {
          key: d.key,
          name: d.name,
          label: meta.label,
          cls: status,
          desc: (isWarn && this.data.detail) ? this.data.detail : (meta.desc + (d.extra || '')),
          isWarn: isWarn
        };
      });
      const alts = this.data.alternatives || [];
      this.setData({
        rows: rows,
        hasWarn: hasWarn,
        altItems: alts.map((a, i) => ({ key: i, name: a.name || '' })).filter((x) => x.name)
      });
    }
  }
});
