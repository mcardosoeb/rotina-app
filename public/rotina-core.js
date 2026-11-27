/* Rotina PMSC — regras da rotina compartilhadas entre o app (navegador) e o servidor (coach).
   No navegador vira a variável global RotinaCore; no Node, module.exports. */
(function (root, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.RotinaCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Modelos de dia (o "tipo de dia" escolhe qual modelo a rotina segue)
  const TEMPLATES = [
    ['seg', 'Seg', 'segundas'],
    ['ter', 'Ter', 'terças'],
    ['qua', 'Qua', 'quartas'],
    ['qui', 'Qui', 'quintas'],
    ['sex', 'Sex', 'sextas'],
    ['sab', 'Sáb', 'sábados'],
    ['dom', 'Dom', 'domingos'],
    ['servico', 'Serviço', 'dias de serviço'],
  ];
  const TEMPLATE_KEYS = TEMPLATES.map((t) => t[0]);
  const WEEKDAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  const CATS = {
    estudo: 'Estudo', refeicao: 'Refeição', treino: 'Treino', familia: 'Família',
    leitura: 'Leitura', sono: 'Sono', rotina: 'Rotina',
  };

  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  function weekdayKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return WEEKDAY_KEYS[new Date(y, m - 1, d).getDay()];
  }

  function newId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Ordena pelo horário; o que acontece de madrugada (antes das 04h) fica no fim do dia
  const sortKey = (t) => (t < '04:00' ? '1' : '0') + t;
  function sortItems(list) {
    return list.slice().sort((a, b) => sortKey(a.t).localeCompare(sortKey(b.t)));
  }

  function sanitizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
    const id = typeof it.id === 'string' && /^[\w-]{1,40}$/.test(it.id) ? it.id : newId();
    const t = isTime(it.t) ? it.t : null;
    const title = str(it.title, 80);
    if (!t || !title) return null;
    const out = { id, t, title, sub: str(it.sub, 160), cat: CATS[it.cat] ? it.cat : 'rotina' };
    const min = num(it.min);
    const kcal = num(it.kcal);
    if (min) out.min = Math.min(min, 600);
    if (kcal != null && out.cat === 'refeicao') out.kcal = Math.min(kcal, 5000);
    if (it.optional) out.optional = true;
    if (it.info) out.info = true;
    return out;
  }

  function sanitizeList(list) {
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    const out = [];
    for (const raw of list.slice(0, 60)) {
      const it = sanitizeItem(raw);
      if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
    }
    return sortItems(out);
  }

  // ---------------------------------------------------------------
  // Rotina padrão (o plano original), usada na primeira vez e em "Restaurar"
  // ---------------------------------------------------------------
  const CYCLE = {
    1: { b1: 'Legislação Institucional', b2: 'Língua Portuguesa', b3: 'Erros do simulado de domingo' },
    2: { b1: 'Processo Penal', b2: 'Informática', b3: 'Caderno de erros + flashcards' },
    3: { b1: 'Direito Penal Militar', b2: 'Legislação de Trânsito', b3: 'Caderno de erros + flashcards' },
    4: { b1: 'Direito Constitucional', b2: 'Língua Portuguesa', b3: 'Caderno de erros + flashcards' },
    5: { b1: 'Processo Penal', b2: 'Direito Penal Comum', b3: 'Revisão da semana (caderno de erros)' },
  };
  const TREINO = {
    1: ['Superior A', 'Supino reto, remada curvada, desenvolvimento, barra, tríceps, bíceps'],
    2: ['Inferior A', 'Agachamento, leg press, flexora, panturrilha, abdominal'],
    3: ['Corrida 25 min + core 20 min', 'Prancha, abdominal, flexão de braço'],
    4: ['Superior B', 'Supino inclinado, puxada, remada baixa, elevação lateral, paralelas'],
    5: ['Inferior B', 'Terra romeno, afundo, extensora, panturrilha, abdominal'],
  };
  const MEALS = {
    ritual: ['Ritual: limão, gengibre e própolis', '+ 1 copo de água · café preto 150 ml', 10],
    cafe: ['Café da manhã', '3 ovos + 1 pão + 1 banana + café com leite', 560],
    lanche: ['Lanche', 'Pão com pasta de amendoim + banana', 330],
    almoco: ['Almoço (refeitório)', '5–6 col. arroz + feijão + carne/frango (palma da mão) + salada', 780],
    pre: ['Pré-treino', '2 pães + 2 ovos (ou banana + aveia + mel)', 400],
    whey: ['Whey + creatina', '1 dose de whey · 3–5 g de creatina', 120],
    jantar: ['Jantar', 'Arroz + feijão + carne moída ou 3 ovos + legumes', 550],
    ceia: ['Ceia', '250 ml de leite + 2 colheres de aveia', 225],
  };
  const meal = (id, t, title) => ({ id, t, title: title || MEALS[id][0], sub: MEALS[id][1], cat: 'refeicao', kcal: MEALS[id][2] });
  const S = (id, t, title, sub, min) => ({ id, t, title, sub, cat: 'estudo', min });
  const I = (t, title) => ({ id: 'info_' + t.replace(':', ''), t, title, sub: '', cat: 'rotina', info: true });
  const E = (id, t, title, sub, cat, extra) => ({ id, t, title, sub, cat, ...extra });

  function weekdayTemplate(wd) {
    const c = CYCLE[wd];
    const [tr, trSub] = TREINO[wd];
    const terca = wd === 2;
    const list = [
      E('acordar', '04:45', 'Acordar', 'Celular longe, sem redes sociais', 'sono'),
      meal('ritual', '04:45'),
      S('b1', '05:00', 'Bloco 1 · 75 min', c.b1 + ' · lei seca + questões', 75),
      meal('cafe', '06:15'),
      I('07:45', 'Trabalho 07h45–12h00'),
      meal('lanche', '09:30'),
      meal('almoco', '12:00'),
      S('b2', '12:30', 'Bloco 2 · 40 min', c.b2 + ' · só questões', 40),
      E('cochilo', '13:10', 'Cochilo de 15 min', 'Último café do dia ao acordar', 'sono'),
      I('13:30', 'Trabalho 13h30–16h45'),
      meal('pre', '15:45'),
      E('treino', '17:05', 'Treino: ' + tr, trSub, 'treino'),
      meal('whey', '18:20'),
      S('b3', '18:30', 'Bloco 3 · 30 min', c.b3, 30),
      meal('jantar', '19:00', 'Jantar com sua esposa'),
    ];
    if (terca) {
      list.push(
        E('familia', '19:00', 'Tempo com a família', '19h00–19h45', 'familia'),
        E('igreja', '20:00', 'Igreja (Caminho)', '20h–21h', 'familia'),
        meal('ceia', '21:10'),
        E('leitura', '21:15', 'Leitura · 50 min', 'Livro pessoal', 'leitura', { min: 50 }),
      );
    } else {
      list.push(
        E('familia', '19:00', 'Tempo com a família', '19h–21h, sem celular na mesa', 'familia'),
        E('leitura', '21:00', 'Leitura · 1h', 'Livro pessoal', 'leitura', { min: 60 }),
        meal('ceia', '21:30'),
      );
    }
    list.push(E('dormir', '22:15', 'Dormir às 22h15', 'Roupa e material separados', 'sono'));
    return list;
  }

  function defaultTemplates() {
    const t = {
      seg: weekdayTemplate(1), ter: weekdayTemplate(2), qua: weekdayTemplate(3), qui: weekdayTemplate(4), sex: weekdayTemplate(5),
      sab: [
        E('acordar', '05:45', 'Acordar', 'Sono de recuperação', 'sono'),
        meal('ritual', '05:45'),
        meal('cafe', '06:00'),
        S('s1', '06:30', 'Estudo S1 · 90 min', 'Legislação Institucional', 90),
        S('s2', '08:15', 'Estudo S2 · 60 min', 'Redação: 1 texto completo (20–30 linhas), cronometrado', 60),
        meal('lanche', '09:15'),
        S('s3', '09:30', 'Estudo S3 · 60 min', 'Legislação Especial', 60),
        E('treino', '10:45', 'Corrida leve 30–40 min', 'Ritmo de conversa', 'treino'),
        meal('whey', '11:30'),
        meal('almoco', '12:00'),
        E('prep', '13:00', 'Preparar base dos jantares', 'Arroz, feijão e carne moída', 'rotina'),
        E('leitura', '15:00', 'Leitura · 1h', 'Livro pessoal', 'leitura', { min: 60 }),
        meal('pre', '16:00', 'Lanche da tarde'),
        E('familia', '16:00', 'Família / livre', '16h–18h e à noite', 'familia'),
        E('igreja', '18:15', 'Igreja', '', 'familia'),
        meal('jantar', '19:30'),
        meal('ceia', '21:30'),
        E('dormir', '22:30', 'Dormir até 22h30', '', 'sono'),
      ],
      dom: [
        E('acordar', '06:30', 'Acordar', '', 'sono'),
        meal('ritual', '06:30'),
        meal('cafe', '07:00'),
        E('missa', '08:00', 'Missa', '', 'familia'),
        meal('lanche', '10:00'),
        E('familia', '10:00', 'Família', '10h–12h e 19h–21h', 'familia'),
        meal('almoco', '12:00'),
        S('simulado', '13:00', 'Simulado completo · 5h', '60 questões + redação, cronometrado', 300),
        meal('pre', '15:30', 'Lanche durante o simulado'),
        S('correcao', '18:00', 'Correção do simulado · 45 min', 'Anotar cada erro e o motivo', 45),
        meal('whey', '18:45'),
        meal('jantar', '19:00'),
        E('leitura', '21:00', 'Leitura · 1h', 'Livro pessoal', 'leitura', { min: 60 }),
        meal('ceia', '21:30'),
        E('dormir', '22:15', 'Dormir às 22h15', 'Amanhã acorda 04h45', 'sono'),
      ],
      servico: [
        E('acordar', '05:45', 'Acordar', '', 'sono'),
        meal('ritual', '05:45'),
        meal('cafe', '06:15'),
        I('07:30', 'Serviço 07h30–09h30'),
        meal('lanche', '09:45'),
        S('b1', '10:00', 'Bloco 1 · 60 min', 'Matéria do bloco 1 do dia', 60),
        S('b2', '11:10', 'Bloco 2 · 60 min', 'Matéria do bloco 2 do dia', 60),
        meal('almoco', '12:15'),
        E('cochilo', '13:00', 'Cochilo de 90 min', 'Repor a noite partida', 'sono'),
        meal('pre', '14:45'),
        E('treino', '15:15', 'Treino (opcional)', 'Treino do dia, se der', 'treino', { optional: true }),
        meal('whey', '16:30'),
        E('leitura', '17:00', 'Leitura · 1h', 'Livro pessoal', 'leitura', { min: 60 }),
        meal('jantar', '18:15'),
        I('19:00', 'Serviço 19h00–19h30'),
        E('sono1', '19:45', 'Sono parte 1 (até 22h40)', '', 'sono'),
        meal('ceia', '22:45', 'Ceia (antes do serviço)'),
        I('23:00', 'Serviço 23h00–00h00'),
        E('sono2', '00:15', 'Sono parte 2 (até 05h30)', '06h00 volta ao serviço', 'sono'),
      ],
    };
    for (const k of TEMPLATE_KEYS) t[k] = sanitizeList(t[k]);
    return t;
  }

  // ---------------------------------------------------------------
  // Edição (usada pelo app e pelas ferramentas do coach)
  // ---------------------------------------------------------------
  function ensureDay(state, date) {
    if (!state.days[date]) {
      state.days[date] = { type: weekdayKey(date), checks: {}, times: {}, water: 0, coffee: 0, q: '', a: '' };
    }
    return state.days[date];
  }

  function upsertInto(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    return sortItems(list);
  }

  // scope 'dia': só naquela data (cria uma cópia do modelo para o dia)
  // scope 'modelo': no modelo inteiro (e também no dia aberto, se ele tiver cópia própria)
  function upsertEvent(state, { scope, template, date, item }) {
    const it = sanitizeItem(item);
    if (!it) throw new Error('evento inválido (precisa de horário HH:MM e título)');
    if (scope === 'dia') {
      if (!isDate(date)) throw new Error('data inválida');
      const day = ensureDay(state, date);
      if (!day.items) day.items = (state.templates[day.type] || []).map((x) => ({ ...x }));
      day.items = upsertInto(day.items, it);
    } else {
      if (!TEMPLATE_KEYS.includes(template)) throw new Error('modelo inválido');
      state.templates[template] = upsertInto(state.templates[template] || [], it);
      if (isDate(date) && state.days[date] && state.days[date].items && state.days[date].type === template) {
        state.days[date].items = upsertInto(state.days[date].items, { ...it });
      }
    }
    return it;
  }

  function deleteEvent(state, { scope, template, date, id }) {
    let removed = null;
    const drop = (list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) removed = list.splice(i, 1)[0];
      return list;
    };
    if (scope === 'dia') {
      if (!isDate(date)) throw new Error('data inválida');
      const day = ensureDay(state, date);
      if (!day.items) day.items = (state.templates[day.type] || []).map((x) => ({ ...x }));
      drop(day.items);
    } else {
      if (!TEMPLATE_KEYS.includes(template)) throw new Error('modelo inválido');
      drop(state.templates[template] || []);
      if (isDate(date) && state.days[date] && state.days[date].items && state.days[date].type === template) drop(state.days[date].items);
    }
    if (!removed) throw new Error('evento não encontrado: ' + id);
    return removed;
  }

  function setDayType(state, date, template) {
    if (!isDate(date)) throw new Error('data inválida');
    if (!TEMPLATE_KEYS.includes(template)) throw new Error('modelo inválido');
    const day = ensureDay(state, date);
    day.type = template;
    delete day.items; // passa a seguir o novo modelo
    return day;
  }

  function itemsFor(state, date) {
    const day = state.days[date];
    const type = day ? day.type : weekdayKey(date);
    return sortItems((day && day.items) || state.templates[type] || []);
  }

  return {
    TEMPLATES, TEMPLATE_KEYS, WEEKDAY_KEYS, CATS, isDate, isTime, weekdayKey, newId, sortItems,
    sanitizeItem, sanitizeList, defaultTemplates, ensureDay, upsertEvent, deleteEvent, setDayType, itemsFor,
  };
});
