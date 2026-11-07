// =====================================================================
// Edge Function "usuarios": administração feita pelo site e tarefas
// automáticas (backup semanal e limpeza da lixeira).
// ---------------------------------------------------------------------
// Quem pode chamar:
//   - administradores (login do site), para: convidar, excluir, backup,
//     backups (lista), arquivos (links de todos os arquivos);
//   - o próprio banco (agenda), com o cabeçalho x-aviso-segredo, para:
//     backup (automático) e limpeza.
// Usa SUPABASE_SERVICE_ROLE_KEY (existe sozinha na função) e o segredo
// AVISO_SEGREDO (o mesmo da função "notificar").
// Na função, desligue "Verify JWT" (a conferência é feita aqui dentro).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const BUCKET = 'arquivos';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const low = (e: unknown) => String(e || '').trim().toLowerCase();

async function registrar(por: string, alvo: string, acao: string, detalhe: string) {
  await sb.from('admin_log').insert({ por, alvo, acao, detalhe });
}
async function acharUsuario(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find(x => low(x.email) === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}
// todos os arquivos de uma pasta (com as subpastas)
async function listarTudo(prefixo: string): Promise<{ name: string; size: number }[]> {
  const out: { name: string; size: number }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefixo, { limit: 1000, offset: off });
    if (error) throw error;
    for (const f of data || []) {
      const caminho = prefixo ? prefixo + '/' + f.name : f.name;
      if (f.id === null) out.push(...await listarTudo(caminho));        // é uma pasta
      else out.push({ name: caminho, size: Number((f.metadata || {}).size || 0) });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function apagarArquivos(caminhos: string[]) {
  for (let i = 0; i < caminhos.length; i += 100) await sb.storage.from(BUCKET).remove(caminhos.slice(i, i + 100));
}

// cópia de todas as tabelas (os arquivos ficam no armazenamento; a cópia guarda a lista)
const TABELAS = ['obras', 'registros', 'pendencias', 'pendencia_fotos', 'pendencia_eventos', 'pend_listas', 'pend_config', 'pend_plantas', 'pend_funcionarios', 'membros', 'perfis', 'admin_log', 'lixeira_paineis', 'banco_versao'];
async function montarBackup() {
  const tabelas: Record<string, unknown[]> = {};
  for (const t of TABELAS) {
    const linhas: unknown[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from(t).select('*').range(de, de + 999);
      if (error) { tabelas[t] = [{ erro: error.message }]; break; }
      linhas.push(...(data || [])); if (!data || data.length < 1000) { tabelas[t] = linhas; break; }
    }
  }
  const arquivos = (await listarTudo('')).filter(f => !f.name.startsWith('backups/'));
  return { sistema: 'Ferramentas da Obra', gerado_em: new Date().toISOString(), tabelas, arquivos };
}
async function salvarBackup(b: unknown) {
  const nome = 'backups/' + new Date().toISOString().slice(0, 10) + '.json';
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  await sb.storage.from(BUCKET).remove([nome]);
  const { error } = await sb.storage.from(BUCKET).upload(nome, blob, { contentType: 'application/json', upsert: true });
  if (error) throw error;
  // guarda só as 8 cópias mais recentes
  const lista = (await listarTudo('backups')).map(f => f.name).sort();
  if (lista.length > 8) await apagarArquivos(lista.slice(0, lista.length - 8));
  return nome;
}

// apaga de vez o que está na lixeira há mais de 30 dias
async function limpeza() {
  const limite = new Date(Date.now() - 30 * 864e5).toISOString();
  let pend = 0, obras = 0;
  const { data: ps } = await sb.from('pendencias').select('id,obra').lt('excluida_em', limite);
  for (const p of ps || []) {
    const { data: fs } = await sb.from('pendencia_fotos').select('caminho').eq('pendencia', p.id);
    await apagarArquivos((fs || []).map(f => f.caminho));
    await sb.from('pendencias').delete().eq('id', p.id); pend++;
  }
  const { data: os } = await sb.from('obras').select('id').lt('excluida_em', limite);
  for (const o of os || []) {
    await sb.from('registros').delete().like('painel', '%:' + o.id);
    for (const pasta of ['obras/' + o.id, 'risco/' + o.id, 'concretagem/' + o.id, 'fachada/' + o.id, 'pendencias/' + o.id]) {
      try { await apagarArquivos((await listarTudo(pasta)).map(f => f.name)); } catch (e) { console.warn(pasta, e); }
    }
    await sb.from('lixeira_paineis').delete().like('painel', '%:' + o.id);
    await sb.from('obras').delete().eq('id', o.id); obras++;
  }
  // mapas resetados: apaga de vez a cópia e os arquivos que só ela usava (imagens de fundo, logo)
  let mapas = 0;
  const { data: ls, error: el } = await sb.from('lixeira_paineis').select('id,painel,registros').lt('excluida_em', limite);
  if (!el) for (const l of ls || []) {
    const [ferr, obra] = String(l.painel).split(':');
    const velhos = new Set((JSON.stringify(l.registros).match(new RegExp('"' + ferr + '/' + obra + '/[^"]+"', 'g')) || []).map(x => x.slice(1, -1)));
    if (velhos.size) {
      const { data: atuais } = await sb.from('registros').select('dados').eq('painel', l.painel);
      const usados = JSON.stringify(atuais || []);
      await apagarArquivos([...velhos].filter(c => !usados.includes('"' + c + '"')));
    }
    await sb.from('lixeira_paineis').delete().eq('id', l.id); mapas++;
  }
  if (pend || obras || mapas) await registrar('sistema', '', 'lixeira', 'limpeza: ' + obras + ' obra(s), ' + pend + ' pendência(s) e ' + mapas + ' mapa(s) resetado(s) apagados de vez');
  return { obras, pendencias: pend, mapas };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const corpo = await req.json().catch(() => ({}));
    const acao = String(corpo.acao || '');

    // chamadas do próprio banco (agenda)
    const segredo = (req.headers.get('x-aviso-segredo') || '').trim();
    if (segredo) {
      if (!env('AVISO_SEGREDO') || segredo !== env('AVISO_SEGREDO')) return resp({ erro: 'não autorizado' }, 401);
      if (acao === 'limpeza') return resp(await limpeza());
      if (acao === 'backup') { const n = await salvarBackup(await montarBackup()); await registrar('sistema', '', 'backup', 'backup automático: ' + n); return resp({ ok: true, arquivo: n }); }
      return resp({ erro: 'ação desconhecida' }, 400);
    }

    // chamadas do site: precisa estar logado e ser administrador
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user || !user.email) return resp({ erro: 'Entre no site novamente.' }, 401);
    const eu = low(user.email);
    const { data: ms } = await sb.from('membros').select('email,admin');   // admin = perfil Administrador
    if (!(ms || []).some(m => low(m.email) === eu && m.admin)) return resp({ erro: 'Só administradores podem fazer isso.' }, 403);

    if (acao === 'backup') {
      const b = await montarBackup();
      let arquivo = '';
      try { arquivo = await salvarBackup(b); } catch (e) { console.warn('backup', e); }
      await registrar(eu, '', 'backup', 'backup baixado' + (arquivo ? ' e guardado em ' + arquivo : ''));
      return resp(b);
    }
    if (acao === 'backups') {
      const lista = (await listarTudo('backups')).sort((a, b) => b.name.localeCompare(a.name));
      const out = [];
      for (const f of lista) { const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.name, 3600); out.push({ nome: f.name.replace('backups/', ''), tamanho: f.size, url: data && data.signedUrl }); }
      return resp({ backups: out });
    }
    if (acao === 'arquivos') {
      const lista = (await listarTudo('')).filter(f => !f.name.startsWith('backups/'));
      const out = [];
      for (let i = 0; i < lista.length; i += 100) {
        const parte = lista.slice(i, i + 100);
        const { data } = await sb.storage.from(BUCKET).createSignedUrls(parte.map(f => f.name), 3600);
        (data || []).forEach((d, k) => out.push({ nome: parte[k].name, tamanho: parte[k].size, url: d.signedUrl }));
      }
      await registrar(eu, '', 'backup', 'download de ' + out.length + ' arquivo(s)');
      return resp({ arquivos: out });
    }

    const email = low(corpo.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp({ erro: 'E-mail inválido.' }, 400);

    if (acao === 'convidar') {
      const redirect = String(corpo.redirect || '');
      const { error } = await sb.auth.admin.inviteUserByEmail(email, redirect ? { redirectTo: redirect } : undefined);
      if (error) {
        // a conta já existe: manda um link para criar/redefinir a senha
        if (/already|registered|exists/i.test(error.message)) {
          const { error: e2 } = await sb.auth.resetPasswordForEmail(email, redirect ? { redirectTo: redirect } : undefined);
          if (e2) return resp({ erro: e2.message }, 400);
          await registrar(eu, email, 'senha', 'link para criar/redefinir a senha (a conta já existia)');
          return resp({ ok: true, existia: true });
        }
        return resp({ erro: error.message }, 400);
      }
      await registrar(eu, email, 'convite', 'convite enviado por e-mail');
      return resp({ ok: true });
    }

    if (acao === 'excluir') {
      if (email === eu) return resp({ erro: 'Você não pode excluir a sua própria conta.' }, 400);
      const alvoAdmin = (ms || []).some(m => low(m.email) === email && m.admin);
      if (alvoAdmin && (ms || []).filter(m => m.admin).length <= 1) return resp({ erro: 'Esta é a única conta de administrador.' }, 400);
      const u = await acharUsuario(email);
      if (u) { const { error } = await sb.auth.admin.deleteUser(u.id); if (error) return resp({ erro: error.message }, 400); }
      // tira o acesso, o nome e os aparelhos inscritos (os registros feitos pela pessoa continuam)
      await sb.from('membros').delete().ilike('email', email);
      await sb.from('perfis').delete().ilike('email', email);
      await sb.from('push_inscricoes').delete().ilike('email', email);
      await registrar(eu, email, 'exclusao', u ? 'conta excluída' : 'acesso removido (não havia conta)');
      return resp({ ok: true });
    }

    return resp({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e);
    return resp({ erro: (e as Error).message }, 500);
  }
});
