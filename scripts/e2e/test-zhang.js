const loader = require('/Users/karl/Documents/workspaceMoney/small-wechat/hanzi-naming/cloudfunctions/generate/lib/data-loader');
const solver = require('/Users/karl/Documents/workspaceMoney/small-wechat/hanzi-naming/cloudfunctions/generate/lib/solver');
const engine = require('/Users/karl/Documents/workspaceMoney/small-wechat/hanzi-naming/cloudfunctions/generate/lib/engine/generate');

const cases = [
  { surname: '张', gender: 'female', styles: [], constraints: {} },
  { surname: '张', gender: 'female', styles: ['温柔诗意'], constraints: {} },
  { surname: '沈', gender: 'female', styles: [], constraints: {} }
];

for (const c of cases) {
  const solved = solver.solve({ surname: c.surname, gender: c.gender, styles: c.styles, constraints: c.constraints, params: loader.engineParams });
  const result = engine.generate({
    surname: c.surname, surnameMeta: solved.surnameMeta, gender: c.gender,
    styles: c.styles, constraints: c.constraints, pool: solved.pool, params: loader.engineParams, batch: 1
  });
  const names = result.candidates.slice(0, 10).map(x => x.name + '(' + x.chars.map(ch => ch.char).join('') + ')');
  console.log('---', c.surname, c.gender, c.styles.join('+') || '无风格', 'poolSize=' + solved.pool.length);
  console.log(names.join(' | '));
}
