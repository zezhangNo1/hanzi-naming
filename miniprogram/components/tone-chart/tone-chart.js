/**
 * tone-chart — 平仄图组件（INTENT-T08 音律维可视化）
 *
 * 输入：pinyin（逐字带调拼音数组）、tones（逐字 'ping'|'ze' 数组，含姓氏）。
 * 展示：逐字平/仄色块（平=宣纸深底、仄=朱砂浅底）+ 拼音，底部声调组合摘要。
 */
'use strict';

/** 平/仄 → 展示字（与结果页 TONE_LABELS 一致） */
const TONE_LABELS = { ping: '平', ze: '仄' };

Component({
  properties: {
    /** 逐字带调拼音（如 ['shěn','shī','tíng']） */
    pinyin: {
      type: Array,
      value: []
    },
    /** 逐字平仄（如 ['ze','ping','ping']） */
    tones: {
      type: Array,
      value: []
    }
  },

  data: {
    /** 渲染块：[{ key, pinyin, tone, label }] */
    items: [],
    /** 摘要（如「2 平 1 仄」） */
    summary: ''
  },

  observers: {
    'pinyin, tones': function () {
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
      const tones = this.data.tones || [];
      const pinyin = this.data.pinyin || [];
      let pingCount = 0;
      let zeCount = 0;
      const items = tones.map((t, i) => {
        if (t === 'ping') pingCount++;
        else zeCount++;
        return {
          key: i,
          pinyin: pinyin[i] || '',
          tone: t === 'ping' ? 'ping' : 'ze',
          label: TONE_LABELS[t] || '仄'
        };
      });
      this.setData({
        items: items,
        summary: pingCount + ' 平 ' + zeCount + ' 仄'
      });
    }
  }
});
