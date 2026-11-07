/* =====================================================================
   Configuração do Mapa de Risco
   ---------------------------------------------------------------------
   Cole aqui os dados do seu projeto no Supabase
   (Supabase > Project Settings > API):
     - supabaseUrl:     "Project URL"
     - supabaseAnonKey: chave "anon" / "publishable" (pode ficar pública;
                        quem protege os dados são as regras do banco.sql)
   NUNCA cole aqui a chave "service_role" / "secret".

   Deixando supabaseUrl vazio, o painel funciona sem login e guarda
   tudo só no navegador de quem abrir (modo local).
   ===================================================================== */
window.MAPA_CONFIG = {
  supabaseUrl: 'https://bqqcllclzlyauprgpjjo.supabase.co',
  supabaseAnonKey: 'sb_publishable_w4e3eZ2J2YxzJh0kN2SxuA_QdomuryJ',

  // Nome que aparece na tela de login da página inicial
  // (nas ferramentas aparece o nome de cada uma).
  titulo: 'Ferramentas da Obra',

  // true mostra "Criar conta" na tela de login. Mesmo assim a pessoa só
  // vê os dados depois que o e-mail dela for incluído na tabela "membros".
  permitirCadastro: false,

  // Nome do bucket de arquivos criado pelo banco.sql.
  bucket: 'arquivos',

  // Chave pública das notificações (VAPID). Pode ficar pública; a chave
  // privada fica só nos segredos da Edge Function no Supabase.
  vapidPublica: 'BHBLeUhhg0FiaFKZRMfidZKoBfxi1fvPIXzs4XV03hMmHBi1WCV0EKXr4vWfH-IAd4B7wpMr0VGp2QLmmzAzfmo'
};
