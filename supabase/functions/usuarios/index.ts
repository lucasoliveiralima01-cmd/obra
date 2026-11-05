// =====================================================================
// Edge Function "usuarios": convites e exclusão de contas, pelo site.
// ---------------------------------------------------------------------
// Só administradores (membros.admin = true) conseguem usar.
// Usa a chave de serviço do próprio Supabase (SUPABASE_SERVICE_ROLE_KEY),
// que existe automaticamente na função e nunca vai para o site.
// Na função, desligue "Verify JWT" (o login é conferido aqui dentro).
//
// Ações (POST, JSON):
//   { acao: 'convidar', email, redirect }   envia o convite por e-mail
//   { acao: 'excluir',  email }             apaga a conta e o acesso
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // quem está pedindo: precisa estar logado e ser administrador
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user || !user.email) return resp({ erro: 'Entre no site novamente.' }, 401);
    const eu = low(user.email);
    const { data: ms } = await sb.from('membros').select('email,admin');
    if (!(ms || []).some(m => low(m.email) === eu && m.admin)) return resp({ erro: 'Só administradores podem fazer isso.' }, 403);

    const corpo = await req.json().catch(() => ({}));
    const email = low(corpo.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp({ erro: 'E-mail inválido.' }, 400);

    if (corpo.acao === 'convidar') {
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

    if (corpo.acao === 'excluir') {
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
