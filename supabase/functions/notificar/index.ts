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

type Membro = { email: string; cargo: string | null; disciplinas: string[] | null };
type Aviso = { title: string; body: string; url: string; tag: string };

async function membros(): Promise<Membro[]> {
  const { data, error } = await sb.from('membros').select('email,cargo,disciplinas');
  if (error) throw error;
  return (data || []) as Membro[];
}
const encarregadosDe = (ms: Membro[], disc: string) => ms.filter(m => m.cargo === 'encarregado' && (m.disciplinas || []).includes(disc)).map(m => low(m.email));
const doCargo = (ms: Membro[], cargo: string) => ms.filter(m => m.cargo === cargo).map(m => low(m.email));
// quem corrige: o funcionário escolhido na pendência (se ele tem acesso ao sistema);
// sem ninguém escolhido (ou sem e-mail), todos os encarregados do cargo
async function corrigeQuem(ms: Membro[], p: Record<string, unknown>): Promise<string[]> {
  if (p.responsavel) {
    const { data } = await sb.from('pend_funcionarios').select('email').eq('id', p.responsavel).maybeSingle();
    if (data && data.email) return [low(data.email)];
  }
  return encarregadosDe(ms, String(p.disciplina || ''));
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

// um evento do histórico: nova pendência, corrigida, reprovada
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
  if (ev.acao === 'criada') {
    para = await corrigeQuem(ms, p);
    title = 'Nova pendência ' + num + ' · ' + (PRI[p.prioridade] || p.prioridade) + obra;
  } else if (ev.acao === 'status' && ev.para === 'corrigida') {
    para = doCargo(ms, p.seguranca ? 'seguranca' : 'engenharia');
    title = 'Pendência ' + num + ' corrigida · conferir' + obra;
    if (ev.comentario) body += '\n' + ev.comentario;
  } else if (ev.acao === 'status' && ev.para === 'aberta' && (ev.de === 'corrigida' || ev.de === 'fechada')) {
    para = await corrigeQuem(ms, p);
    title = 'Pendência ' + num + (ev.de === 'fechada' ? ' reaberta' : ' reprovada') + obra;
    if (ev.comentario) body += '\nMotivo: ' + ev.comentario;
  } else if (ev.acao === 'comentario') {
    // comentário do encarregado vai para quem fecha; de quem fecha (ou outro), para os encarregados
    const quem = ms.find(m => low(m.email) === low(ev.por));
    const fecha = doCargo(ms, p.seguranca ? 'seguranca' : 'engenharia');
    para = quem && quem.cargo === 'encarregado' ? fecha : (await corrigeQuem(ms, p)).concat(fecha);
    title = 'Comentário na pendência ' + num + obra;
    body = rotulo(p) + '\n' + (ev.comentario || '');
  } else return { enviados: 0, motivo: 'evento sem aviso' };
  para = para.filter(e => e !== low(ev.por));   // quem fez não recebe o próprio aviso
  return { enviados: await enviar(para, { title, body, url, tag: 'pend-' + p.id }) };
}

// todo dia: vencidas para a disciplina e para quem fecha; resumo para a Engenharia
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
      enviados += await enviar(doCargo(ms, 'engenharia'), { title: 'Corpos de prova · ' + nomeObra(r.obra),
        body: [r.hoje ? r.hoje + ' rompem hoje' : '', r.pendentes ? r.pendentes + ' sem resultado lançado' : ''].filter(Boolean).join(' · '),
        url: site + 'concretagem.html?obra=' + encodeURIComponent(r.obra), tag: 'cp-' + r.obra });
    }
  } catch (e) { console.warn('rompimentos', e); }
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
    // as outras, por disciplina, para os encarregados
    const semPessoa = venc.filter(p => !dePessoa(p));
    for (const disc of [...new Set(semPessoa.map(p => p.disciplina))]) {
      const v = semPessoa.filter(p => p.disciplina === disc);
      enviados += await enviar(encarregadosDe(ms, disc), { title: v.length + ' pendência' + (v.length > 1 ? 's vencidas' : ' vencida') + ' · ' + disc,
        body: nomeObra(obra) + ': ' + v.map(p => '#' + p.numero).join(', '), url, tag: 'venc-' + obra + '-' + disc });
    }
    // Segurança: vencidas de segurança
    const vs = venc.filter(p => p.seguranca);
    if (vs.length) enviados += await enviar(doCargo(ms, 'seguranca'), { title: vs.length + ' pendência(s) de segurança vencida(s)', body: nomeObra(obra) + ': ' + vs.map(p => '#' + p.numero).join(', '), url, tag: 'venc-seg-' + obra });
    // Engenharia: resumo do dia
    const ab = da.filter(p => p.status === 'aberta').length, ec = da.filter(p => p.status === 'em_correcao').length, co = da.filter(p => p.status === 'corrigida').length;
    if (ab + ec + co) {
      const crit = venc.filter(p => p.prioridade === 'critica').length;
      enviados += await enviar(doCargo(ms, 'engenharia'), { title: 'Resumo das pendências · ' + nomeObra(obra),
        body: ab + ' aberta(s), ' + ec + ' em correção, ' + co + ' corrigida(s) aguardando aprovação' + (venc.length ? ' · ' + venc.length + ' vencida(s)' + (crit ? ' (' + crit + ' crítica' + (crit > 1 ? 's' : '') + ')' : '') : ''),
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
      const para = doCargo(ms, 'engenharia').filter(e => e !== low(corpo.por));
      return resp({ enviados: await enviar(para, { title: String(corpo.titulo || 'Concreto abaixo do fck'), body: String(corpo.corpo || ''),
        url: site + 'concretagem.html?obra=' + encodeURIComponent(String(corpo.obra || '')), tag: 'concreto-' + corpo.obra }) });
    }
    return resp({ erro: 'tipo desconhecido' }, 400);
  } catch (e) {
    console.error(e);
    return resp({ erro: (e as Error).message }, 500);
  }
});
