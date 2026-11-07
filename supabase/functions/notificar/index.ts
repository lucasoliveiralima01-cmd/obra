// =====================================================================
// Edge Function "notificar": avisos (Web Push) das pendências de obra
// ---------------------------------------------------------------------
// Chamada pelo banco (gatilho em pendencia_eventos e agenda diária),
// com o cabeçalho x-aviso-segredo, ou pelo site (botão "Enviar teste"),
// com o login da pessoa.
//
// Segredos necessários (Supabase > Edge Functions > Secrets):
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, AVISO_SEGREDO
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.
// Na função, desligue "Verify JWT" (a conferência é feita aqui dentro).
// =====================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
// as chaves são conferidas a cada chamada: se faltar algum segredo, a função responde dizendo qual
// (em vez de cair ao iniciar)
let vapidOk = false;
function configurar(): string | null {
  const falta = ['VAPID_PUBLIC', 'VAPID_PRIVATE', 'AVISO_SEGREDO'].filter(k => !env(k));
  if (falta.length) return 'Faltam os segredos da função: ' + falta.join(', ') + ' (Edge Functions > Secrets).';
  if (!vapidOk) {
    try {
      let sub = env('VAPID_SUBJECT') || 'mailto:admin@exemplo.com';
      if (!/^(mailto:|https:)/.test(sub)) sub = 'mailto:' + sub;
      webpush.setVapidDetails(sub, env('VAPID_PUBLIC'), env('VAPID_PRIVATE'));
      vapidOk = true;
    } catch (e) { return 'Chaves VAPID inválidas: ' + (e as Error).message; }
  }
  return null;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const PRI: Record<string, string> = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const low = (e: string | null | undefined) => String(e || '').toLowerCase();

type Membro = { email: string; perfil?: string | null; cargo: string | null; disciplinas: string[] | null; obras?: string[] | null };
type Aviso = { title: string; body: string; url: string; tag: string };

async function membros(): Promise<Membro[]> {
  let r = await sb.from('membros').select('email,perfil,cargo,disciplinas,obras');
  if (r.error) r = await sb.from('membros').select('email,cargo,disciplinas');   // banco ainda sem perfis
  if (r.error) throw r.error;
  return (r.data || []) as Membro[];
}
// perfil (bancos antigos: a partir do cargo)
const perfilDe = (m: Membro) => m.perfil || (m.cargo === 'encarregado' ? 'campo' : m.cargo || 'consulta');
// a pessoa tem acesso à obra? (administrador: todas)
const naObra = (m: Membro, obra: string) => !m.perfil || m.perfil === 'admin' || (m.obras || []).includes(obra);
const emails = (ms: Membro[]) => ms.map(m => low(m.email));
// Engenharia (e administradores), Segurança e quem é de campo de um ofício, só da obra
const engenhariaDe = (ms: Membro[], obra: string) => emails(ms.filter(m => ['engenharia', 'admin'].includes(perfilDe(m)) && naObra(m, obra)));
const segurancaDe = (ms: Membro[], obra: string) => emails(ms.filter(m => perfilDe(m) === 'seguranca' && naObra(m, obra)));
const campoDe = (ms: Membro[], disc: string, obra: string) => emails(ms.filter(m => perfilDe(m) === 'campo' && (m.disciplinas || []).includes(disc) && naObra(m, obra)));
// quem decide (avalia, fecha, reprova): Segurança nas de segurança, Engenharia nas outras
const decideDe = (ms: Membro[], p: Record<string, unknown>) => p.seguranca ? segurancaDe(ms, String(p.obra)) : engenhariaDe(ms, String(p.obra));
// quem corrige: o funcionário escolhido na pendência (se ele tem acesso ao sistema);
// sem ninguém escolhido (ou sem e-mail), todos de campo daquele ofício na obra
async function corrigeQuem(ms: Membro[], p: Record<string, unknown>): Promise<string[]> {
  if (p.responsavel) {
    const { data } = await sb.from('pend_funcionarios').select('email').eq('id', p.responsavel).maybeSingle();
    if (data && data.email) return [low(data.email)];
  }
  return campoDe(ms, String(p.disciplina || ''), String(p.obra || ''));
}

// envia para todos os aparelhos das pessoas; apaga inscrições que expiraram
async function enviar(emails: string[], aviso: Aviso): Promise<number> {
  const alvo = [...new Set(emails.map(low).filter(Boolean))];
  if (!alvo.length) return 0;
  const { data, error } = await sb.from('push_inscricoes').select('endpoint,email,p256dh,auth');
  if (error) throw error;
  const subs = (data || []).filter(s => alvo.includes(low(s.email)));
  let n = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(aviso), { TTL: 60 * 60 * 24, urgency: 'high' });
      n++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from('push_inscricoes').delete().eq('endpoint', s.endpoint);
      else console.warn('push falhou', code, (e as Error).message);
    }
  }));
  return n;
}

const rotulo = (p: Record<string, string | null>) => [p.pavimento, p.local_tipo === 'Apartamento' ? (p.unidade ? 'Apto ' + p.unidade : 'Apartamento') : [p.local_tipo, p.unidade].filter(Boolean).join(' '), p.comodo].filter(Boolean).join(' · ');

// um evento do histórico: nova pendência, sugestão, corrigida, reprovada, comentário
async function evento(ev: Record<string, string>, site: string) {
  const { data: p, error } = await sb.from('pendencias').select('*').eq('id', ev.pendencia).maybeSingle();
  if (error) throw error;
  if (!p) return { enviados: 0, motivo: 'pendência não existe' };
  const { data: o } = await sb.from('obras').select('nome').eq('id', p.obra).maybeSingle();
  const ms = await membros();
  const num = p.numero ? '#' + p.numero : 'Nova';
  const url = site + 'pendencias.html?obra=' + encodeURIComponent(p.obra) + '&p=' + p.id;
  const obra = o && o.nome ? ' · ' + o.nome : '';
  let para: string[] = []; let title = ''; let body = rotulo(p) + ' — ' + p.tipo;
  if (ev.acao === 'criada' && (ev.para === 'avaliacao' || p.status === 'avaliacao')) {
    // sugestão de quem é de campo (Engenharia avalia) ou pendência de segurança encaminhada (Segurança avalia)
    para = decideDe(ms, p);
    title = (p.seguranca ? 'Pendência de segurança para avaliar ' : 'Sugestão de pendência ') + num + obra;
  } else if (ev.acao === 'criada' || (ev.acao === 'status' && ev.de === 'avaliacao' && ev.para === 'aberta')) {
    para = await corrigeQuem(ms, p);
    title = 'Nova pendência ' + num + ' · ' + (PRI[p.prioridade] || p.prioridade) + obra;
  } else if (ev.acao === 'status' && ev.para === 'recusada') {
    para = [low(p.criado_por)];
    title = 'Sugestão ' + num + ' não aprovada' + obra;
    if (ev.comentario) body += '\nMotivo: ' + ev.comentario;
  } else if (ev.acao === 'status' && ev.para === 'corrigida') {
    para = decideDe(ms, p);
    title = 'Pendência ' + num + ' corrigida · conferir' + obra;
    if (ev.comentario) body += '\n' + ev.comentario;
  } else if (ev.acao === 'status' && ev.para === 'aberta' && (ev.de === 'corrigida' || ev.de === 'fechada')) {
    para = await corrigeQuem(ms, p);
    title = 'Pendência ' + num + (ev.de === 'fechada' ? ' reaberta' : ' reprovada') + obra;
    if (ev.comentario) body += '\nMotivo: ' + ev.comentario;
  } else if (ev.acao === 'comentario') {
    // comentário de quem é de campo vai para quem decide; de quem decide (ou outro), para quem corrige também
    const quem = ms.find(m => low(m.email) === low(ev.por));
    const decide = decideDe(ms, p);
    para = quem && perfilDe(quem) === 'campo' ? decide.concat(low(p.criado_por)) : (p.status === 'avaliacao' ? [low(p.criado_por)] : await corrigeQuem(ms, p)).concat(decide);
    title = 'Comentário na pendência ' + num + obra;
    body = rotulo(p) + '\n' + (ev.comentario || '');
  } else return { enviados: 0, motivo: 'evento sem aviso' };
  para = para.filter(e => e !== low(ev.por));   // quem fez não recebe o próprio aviso
  return { enviados: await enviar(para, { title, body, url, tag: 'pend-' + p.id }) };
}

// Mapa de Fachadas: aplicações cuja cura termina hoje, agrupadas por fachada e camada
const somaDias = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
async function fachadasLiberadas(hoje: string, site: string, nomeObra: (id: string) => string, paraDe: (obra: string) => string[]): Promise<number> {
  const { data, error } = await sb.from('registros').select('painel,colecao,id,dados').like('painel', 'fachada:%').in('colecao', ['config', 'camadas', 'aplicacoes']);
  if (error) throw error;
  const porObra = new Map<string, { fach: Record<string, string>; cam: Record<string, { nome: string; cura: number; ordem: number }>; apl: Record<string, unknown>[] }>();
  for (const r of data || []) {
    const obra = String(r.painel).split(':')[1]; if (!obra) continue;
    const o = porObra.get(obra) || { fach: {}, cam: {}, apl: [] }; porObra.set(obra, o);
    const d = r.dados || {};
    if (r.colecao === 'config' && Array.isArray(d.fachadas)) for (const f of d.fachadas) o.fach[f.id] = f.nome;
    if (r.colecao === 'camadas') o.cam[d.id || r.id] = { nome: d.nome, cura: +d.cura || 0, ordem: +d.ordem || 0 };
    if (r.colecao === 'aplicacoes') o.apl.push(d);
  }
  let n = 0;
  for (const [obra, o] of porObra) {
    const ord = Object.entries(o.cam).sort((a, b) => a[1].ordem - b[1].ordem);
    const grupos = new Map<string, { area: number; qtd: number }>();
    for (const a of o.apl) {
      const c = o.cam[String(a.camada)]; if (!c || !c.cura || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.data))) continue;
      if (somaDias(String(a.data), c.cura) !== hoje) continue;
      const i = ord.findIndex(x => x[0] === a.camada); const prox = i >= 0 && ord[i + 1] ? ord[i + 1][1].nome : '';
      const k = (o.fach[String(a.fachada)] || 'Fachada') + ': ' + c.nome + (prox ? ' liberado para ' + prox : ' concluído');
      const g = grupos.get(k) || { area: 0, qtd: 0 }; g.area += +(a.area as number) || 0; g.qtd++; grupos.set(k, g);
    }
    if (!grupos.size) continue;
    const linhas = [...grupos].map(([k, g]) => k + ' (' + g.qtd + ' área' + (g.qtd > 1 ? 's' : '') + ', ' + Math.round(g.area) + ' m²)');
    n += await enviar(paraDe(obra), { title: 'Fachada liberada hoje · ' + nomeObra(obra), body: linhas.join('\n'),
      url: site + 'fachadas.html?obra=' + encodeURIComponent(obra), tag: 'fachada-lib-' + obra });
  }
  return n;
}

// todo dia: vencidas para quem corrige e para quem fecha; resumo para a Engenharia (cada um só das suas obras)
async function diario(site: string) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  // deno-lint-ignore no-explicit-any
  let r: { data: any[] | null; error: any } = await sb.from('pendencias').select('id,obra,numero,status,disciplina,prioridade,prazo,seguranca,responsavel').is('excluida_em', null);
  if (r.error) r = await sb.from('pendencias').select('id,obra,numero,status,disciplina,prioridade,prazo,seguranca').is('excluida_em', null);
  const { data, error } = r;
  if (error) throw error;
  // e-mail de cada funcionário (para as vencidas de quem foi escolhido irem só para ele)
  const emailFunc = new Map<string, string>();
  try { const { data: fs } = await sb.from('pend_funcionarios').select('id,email'); for (const f of fs || []) if (f.email) emailFunc.set(f.id, low(f.email)); } catch (_) { /* tabela ainda não existe */ }
  const ps = data || [];
  const { data: obras } = await sb.from('obras').select('id,nome');
  const nomeObra = (id: string) => ((obras || []).find(o => o.id === id) || { nome: id }).nome;
  const ms = await membros();
  let enviados = 0;
  // corpos de prova que rompem hoje ou estão sem resultado → Engenharia
  try {
    const { data: rs } = await sb.rpc('rompimentos_resumo');
    for (const r of rs || []) {
      if (!r.hoje && !r.pendentes) continue;
      enviados += await enviar(engenhariaDe(ms, r.obra), { title: 'Corpos de prova · ' + nomeObra(r.obra),
        body: [r.hoje ? r.hoje + ' rompem hoje' : '', r.pendentes ? r.pendentes + ' sem resultado lançado' : ''].filter(Boolean).join(' · '),
        url: site + 'concretagem.html?obra=' + encodeURIComponent(r.obra), tag: 'cp-' + r.obra });
    }
  } catch (e) { console.warn('rompimentos', e); }
  // fachadas: áreas cuja cura termina hoje (liberadas para a próxima camada) → Engenharia
  try { enviados += await fachadasLiberadas(hoje, site, nomeObra, obra => engenhariaDe(ms, obra)); } catch (e) { console.warn('fachadas', e); }
  for (const obra of [...new Set(ps.map(p => p.obra))]) {
    const da = ps.filter(p => p.obra === obra);
    const venc = da.filter(p => (p.status === 'aberta' || p.status === 'em_correcao') && p.prazo && p.prazo < hoje);
    const url = site + 'pendencias.html?obra=' + encodeURIComponent(obra);
    // as de quem foi escolhido: para ele
    const dePessoa = (p: Record<string, unknown>) => p.responsavel ? emailFunc.get(String(p.responsavel)) : undefined;
    for (const email of [...new Set(venc.map(dePessoa).filter(Boolean))] as string[]) {
      const v = venc.filter(p => dePessoa(p) === email);
      enviados += await enviar([email], { title: v.length + ' pendência' + (v.length > 1 ? 's vencidas' : ' vencida') + ' para você',
        body: nomeObra(obra) + ': ' + v.map(p => '#' + p.numero).join(', '), url, tag: 'venc-' + obra + '-eu' });
    }
    // as outras, por ofício, para quem é de campo
    const semPessoa = venc.filter(p => !dePessoa(p));
    for (const disc of [...new Set(semPessoa.map(p => p.disciplina))]) {
      const v = semPessoa.filter(p => p.disciplina === disc);
      enviados += await enviar(campoDe(ms, disc, obra), { title: v.length + ' pendência' + (v.length > 1 ? 's vencidas' : ' vencida') + ' · ' + disc,
        body: nomeObra(obra) + ': ' + v.map(p => '#' + p.numero).join(', '), url, tag: 'venc-' + obra + '-' + disc });
    }
    // Segurança: vencidas de segurança
    const vs = venc.filter(p => p.seguranca);
    if (vs.length) enviados += await enviar(segurancaDe(ms, obra), { title: vs.length + ' pendência(s) de segurança vencida(s)', body: nomeObra(obra) + ': ' + vs.map(p => '#' + p.numero).join(', '), url, tag: 'venc-seg-' + obra });
    // Engenharia: resumo do dia
    const ab = da.filter(p => p.status === 'aberta').length, ec = da.filter(p => p.status === 'em_correcao').length, co = da.filter(p => p.status === 'corrigida').length;
    const av = da.filter(p => p.status === 'avaliacao' && !p.seguranca).length;
    if (ab + ec + co + av) {
      const crit = venc.filter(p => p.prioridade === 'critica').length;
      enviados += await enviar(engenhariaDe(ms, obra), { title: 'Resumo das pendências · ' + nomeObra(obra),
        body: ab + ' aberta(s), ' + ec + ' em correção, ' + co + ' corrigida(s) aguardando aprovação' + (av ? ', ' + av + ' sugestão(ões) para avaliar' : '') + (venc.length ? ' · ' + venc.length + ' vencida(s)' + (crit ? ' (' + crit + ' crítica' + (crit > 1 ? 's' : '') + ')' : '') : ''),
        url, tag: 'resumo-' + obra });
    }
  }
  return { enviados };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const falha = configurar();
    if (falha) return resp({ erro: falha }, 500);
    const corpo = await req.json().catch(() => ({}));
    const site = String(corpo.site || Deno.env.get('SITE_URL') || '');
    // aviso de teste, pedido pelo próprio site: confere o login e manda só para a pessoa
    if (corpo.tipo === 'teste') {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: { user } } = await sb.auth.getUser(token);
      if (!user || !user.email) return resp({ erro: 'não autorizado' }, 401);
      const n = await enviar([user.email], { title: 'Avisos ativados', body: 'Este aparelho vai receber os avisos das pendências.', url: site || '/', tag: 'teste' });
      return resp({ enviados: n });
    }
    if ((req.headers.get('x-aviso-segredo') || '').trim() !== env('AVISO_SEGREDO')) return resp({ erro: 'não autorizado' }, 401);
    if (corpo.tipo === 'evento') return resp(await evento(corpo.evento || {}, site));
    if (corpo.tipo === 'diario') return resp(await diario(site));
    // concreto abaixo do fck (avisado pelo Mapa de Concretagem) → Engenharia
    if (corpo.tipo === 'concreto') {
      const ms = await membros();
      const para = engenhariaDe(ms, String(corpo.obra || '')).filter(e => e !== low(corpo.por));
      return resp({ enviados: await enviar(para, { title: String(corpo.titulo || 'Concreto abaixo do fck'), body: String(corpo.corpo || ''),
        url: site + 'concretagem.html?obra=' + encodeURIComponent(String(corpo.obra || '')), tag: 'concreto-' + corpo.obra }) });
    }
    // quebra de cura (avisada pelo Mapa de Fachadas) → Engenharia
    if (corpo.tipo === 'fachada') {
      const ms = await membros();
      const para = engenhariaDe(ms, String(corpo.obra || '')).filter(e => e !== low(corpo.por));
      return resp({ enviados: await enviar(para, { title: String(corpo.titulo || 'Quebra de cura na fachada'), body: String(corpo.corpo || ''),
        url: site + 'fachadas.html?obra=' + encodeURIComponent(String(corpo.obra || '')), tag: 'fachada-' + corpo.obra }) });
    }
    return resp({ erro: 'tipo desconhecido' }, 400);
  } catch (e) {
    console.error(e);
    return resp({ erro: (e as Error).message }, 500);
  }
});
