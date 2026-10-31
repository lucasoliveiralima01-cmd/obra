/* =====================================================================
   Configuração do Mapa de Risco
   ---------------------------------------------------------------------
   Cole aqui os dados do seu projeto no Supabase
   (Supabase > Project Settings > API):
     - supabaseUrl:     "Project URL"
     - supabaseAnonKey: chave "anon" / "publishable" (pode ficar pública;
                        quem protege os dados são as regras do supabase.sql)
   NUNCA cole aqui a chave "service_role" / "secret".

   Deixando supabaseUrl vazio, o painel funciona sem login e guarda
   tudo só no navegador de quem abrir (modo local).
   ===================================================================== */
window.MAPA_CONFIG = {
  supabaseUrl: 'https://bqqcllclzlyauprgpjjo.supabase.co/rest/v1/,
  supabaseAnonKey: 'sb_publishable_w4e3eZ2J2YxzJh0kN2SxuA_QdomuryJ',

  // Nome que aparece na tela de login.
  titulo: 'Mapa de Risco',

  // Painel aberto quando o link não diz qual. Para ter um painel por obra,
  // use o link com ?painel=nome-da-obra (ex.: .../?painel=residencial-x).
  painel: 'principal',

  // true mostra "Criar conta" na tela de login. Mesmo assim a pessoa só
  // vê os dados depois que o e-mail dela for incluído na tabela "membros".
  permitirCadastro: false,

  // Nome do bucket de arquivos criado pelo supabase.sql.
  bucket: 'arquivos'
};
