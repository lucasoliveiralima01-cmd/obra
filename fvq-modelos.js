/* =====================================================================
   Fichas de verificação (FVQ) usadas na conferência por voz.
   Cada item: id, txt (como aparece na ficha), perguntas (variações faladas),
   chaves (palavras que identificam o item numa frase), tipo 'sn' (conforme /
   não conforme) ou 'medida' (unidade e limites: min/max), critico (não entra
   no "o resto tá tudo ok": precisa de resposta própria).
   FVQ-030 é a ficha real da obra; forro e porta são exemplos.
   Medida com aceitaSim: "tá dentro" vale como conforme, sem o número.
   ===================================================================== */
window.FVQ_MODELOS = [
  {
    id: 'fvq-030', codigo: 'FVQ-030', nome: 'Plaqueamento de shaft em drywall', servico: 'Drywall', oficio: 'Gesseiro', tipo: 'Drywall',
    intro: ['Vamos conferir o plaqueamento do shaft {local}.', 'Bora conferir o shaft {local}.', 'Conferência do plaqueamento de shaft {local}. Vamos lá.'],
    secoes: { inicio: ['Começando pelas condições de início.', 'Primeiro, as condições de início.'], execucao: ['Agora a execução do serviço.', 'Partindo pra execução.', 'Condições de início feitas. Agora a execução.'], pos: ['Pra fechar, pós-execução.', 'Agora o pós-execução.'] },
    itens: [
      { id: '1.1', secao: 'inicio', txt: 'Equipamentos, insumos e EPIs disponíveis', chaves: ['equipamento', 'equipamentos', 'insumo', 'insumos', 'epi', 'epis', 'ferramenta', 'ferramentas'],
        perguntas: ['Equipamentos, insumos e EPIs disponíveis?', 'A equipe tem equipamento, insumo e EPI à mão?', 'Tem tudo de equipamento, insumo e EPI?'] },
      { id: '1.2', secao: 'inicio', txt: 'Limpeza do local de trabalho', chaves: ['limpeza do local', 'local limpo', 'local de trabalho', 'local ta limpo', 'local esta limpo'],
        perguntas: ['O local de trabalho está limpo?', 'E a limpeza do local, ok?', 'Local limpo pra trabalhar?'] },
      { id: '1.3', secao: 'inicio', txt: 'Apartamento padrão ou modificado (conferido)', chaves: ['padrao', 'modificado', 'modificacao', 'personalizado'],
        perguntas: ['Conferiu se o apartamento é padrão ou modificado?', 'Esse apartamento é padrão ou tem modificação? Tá conferido?', 'Já checou se é padrão ou modificado?'] },
      { id: '1.4', secao: 'inicio', txt: 'Execução de um protótipo', chaves: ['prototipo'],
        perguntas: ['O protótipo foi executado?', 'Teve protótipo?', 'E o protótipo, feito?'] },
      { id: '1.5', secao: 'inicio', txt: 'Furos nas fachadas (alvenaria e estrutura) na localização correta, conforme projeto', chaves: ['furo', 'furos', 'furacao na fachada', 'furos na fachada'],
        perguntas: ['Os furos na fachada estão no lugar certo do projeto?', 'Furos de alvenaria e estrutura conferem com o projeto?', 'E os furos na fachada, localização ok?'] },
      { id: '1.6', secao: 'inicio', txt: 'Montantes, reforços e guias sem danos', chaves: ['montante', 'montantes', 'reforco', 'reforcos', 'guia', 'guias'],
        perguntas: ['Montantes, reforços e guias sem dano?', 'A estrutura de montante e guia tá inteira, sem dano?', 'Montantes e guias estão inteiros?'] },
      { id: '1.7', secao: 'inicio', txt: 'Especificação das placas (RU, ST, corta-fogo etc.)', chaves: ['especificacao', 'placa ru', 'placa verde', 'resistente a umidade', 'standard', 'corta fogo', 'corta-fogo', 'tipo de placa'],
        perguntas: ['A placa é a especificada? RU, standard ou corta-fogo conforme o projeto?', 'Tipo de placa certo pro local?', 'Conferiu a especificação da placa?'] },
      { id: '1.8', secao: 'inicio', txt: 'Estrutura dos shafts em drywall concluída (PIS 015 A)', chaves: ['estrutura do shaft', 'estrutura dos shafts', 'estrutura concluida', 'estrutura pronta'], critico: true,
        perguntas: ['A estrutura do shaft está concluída?', 'Estrutura do shaft pronta, conforme o PIS 015?', 'E a estrutura dos shafts, finalizada?'] },
      { id: '2.1', secao: 'execucao', txt: 'Fixação e estabilidade dos pontos hidráulicos, elétricos e de gás nos montantes ou reforços', chaves: ['fixacao dos pontos', 'pontos hidraulicos', 'pontos eletricos', 'ponto de gas', 'pontos de gas', 'estabilidade dos pontos', 'pontos'], critico: true,
        perguntas: ['Os pontos hidráulicos, elétricos e de gás estão bem fixados nos montantes?', 'Pontos de hidráulica, elétrica e gás firmes?', 'Os pontos estão todos firmes nos montantes e reforços?'] },
      { id: '2.2', secao: 'execucao', tipo: 'medida', unidade: 'mm', max: 2, aceitaSim: true, txt: 'Distância placa x esperas hidráulicas e elétricas, suficiente para o acabamento (± 2 mm)', chaves: ['esperas hidraulicas', 'esperas eletricas', 'distancia das esperas', 'esperas', 'espera'],
        perguntas: ['A distância da placa até as esperas hidráulicas e elétricas tá boa pro acabamento? Dentro dos 2 milímetros?', 'Esperas de hidráulica e elétrica na distância certa da placa?', 'E as esperas, a saliência ficou dentro dos 2 milímetros?'] },
      { id: '2.3', secao: 'execucao', tipo: 'medida', unidade: 'mm', max: 2, aceitaSim: true, txt: 'Distância placa x esperas de gás, suficiente para a chave grifo (± 2 mm)', chaves: ['esperas de gas', 'espera de gas', 'gas', 'grifo'],
        perguntas: ['E as esperas de gás, dá pra manusear com a chave grifo? Dentro dos 2 milímetros?', 'Distância das esperas de gás ok?'] },
      { id: '2.4', secao: 'execucao', tipo: 'medida', unidade: 'mm', min: 8, max: 12, aceitaSim: true, txt: 'Folga de 1 cm entre chapa e contrapiso, preenchida com silicone (± 2 mm)', chaves: ['folga', 'contrapiso', 'silicone', 'rodape'],
        perguntas: ['A folga de 1 centímetro entre a chapa e o contrapiso, com silicone, tá ok?', 'A folga da chapa pro contrapiso ficou em 1 centímetro?', 'Folga no pé da placa com silicone, conforme?'] },
      { id: '2.5', secao: 'execucao', tipo: 'medida', unidade: 'mm', max: 1, aceitaSim: true, txt: 'Dimensões, esquadro, planicidade e prumo do shaft (± 1 mm)', chaves: ['dimensao', 'dimensoes', 'esquadro', 'planicidade', 'prumo', 'aprumado', 'nivel'], critico: true,
        perguntas: ['Dimensões, esquadro, planicidade e prumo do shaft dentro de 1 milímetro?', 'Passou régua e prumo? Ficou dentro de 1 milímetro?', 'O shaft está no prumo e no esquadro?'] },
      { id: '2.6', secao: 'execucao', txt: 'Fixação e paginação das chapas', chaves: ['paginacao', 'fixacao das chapas', 'parafuso', 'parafusos', 'parafusamento'],
        perguntas: ['Fixação e paginação das chapas ok?', 'As chapas estão bem parafusadas e com a paginação certa?', 'E a paginação das placas?'] },
      { id: '2.7', secao: 'execucao', txt: 'Correção de imperfeições nos cortes', chaves: ['corte', 'cortes', 'imperfeicao', 'imperfeicoes', 'rebarba'],
        perguntas: ['As imperfeições nos cortes foram corrigidas?', 'Os cortes estão bem acabados?', 'Os cortes ficaram sem imperfeição?'] },
      { id: '2.8', secao: 'execucao', txt: 'Massa sobre as juntas aplicada e acabada, com largura conforme projeto', chaves: ['massa', 'massa nas juntas', 'juntas', 'junta', 'largura da junta'],
        perguntas: ['A massa nas juntas está aplicada e bem acabada?', 'Juntas com a massa na largura do projeto?', 'E o acabamento da massa nas juntas?'] },
      { id: '2.9', secao: 'execucao', txt: 'Fita de papel microperfurado sobre as juntas', chaves: ['fita de papel', 'microperfurad', 'fita nas juntas'],
        perguntas: ['A fita de papel microperfurado foi aplicada nas juntas?', 'Tem fita microperfurada em todas as juntas?'] },
      { id: '2.10', secao: 'execucao', txt: 'Estabilidade da placa colada na estrutura de concreto ou alvenaria', chaves: ['placa colada', 'colada', 'colagem', 'estabilidade da placa'],
        perguntas: ['As placas coladas no concreto ou na alvenaria estão firmes?', 'Placa colada estável, sem soltar?'] },
      { id: '2.11', secao: 'execucao', txt: 'Frestas superiores e inferiores preenchidas com massa de gesso', chaves: ['fresta superior', 'frestas superiores', 'frestas inferiores', 'massa de gesso', 'frestas em cima'],
        perguntas: ['As frestas de cima e de baixo foram preenchidas com massa de gesso?', 'Frestas superior e inferior fechadas com gesso?'] },
      { id: '2.12', secao: 'execucao', txt: 'Furação nas placas feita com serra-copo', chaves: ['serra copo', 'serra-copo', 'furacao nas placas', 'furos nas placas'],
        perguntas: ['Os furos nas placas foram feitos com serra-copo?', 'Furação com serra-copo, certinha?'] },
      { id: '2.13', secao: 'execucao', txt: 'Fita nos cantos a 90°', chaves: ['canto', 'cantos', 'fita nos cantos'],
        perguntas: ['Os cantos a 90 graus têm fita?', 'E a fita nos cantos, aplicada?'] },
      { id: '2.14', secao: 'execucao', txt: 'Calafetação das frestas das esperas hidrossanitárias, elétricas e de gás', chaves: ['calafetacao', 'calafetad', 'frestas das esperas', 'vedacao das esperas'],
        perguntas: ['As frestas em volta das esperas foram calafetadas?', 'Calafetação das esperas de hidráulica, elétrica e gás ok?'] },
      { id: '3.1', secao: 'pos', txt: 'Limpeza final', chaves: ['limpeza final', 'limpo', 'limpeza'],
        perguntas: ['Por fim, a limpeza final foi feita?', 'Tudo limpo pra entregar?', 'E a limpeza final?'] }
    ]
  },
  {
    id: 'forro-drywall', nome: 'Forro de drywall (exemplo)', servico: 'Drywall', oficio: 'Gesseiro', tipo: 'Forro',
    intro: ['Vamos conferir o forro {local}.', 'Bora conferir o forro {local}.', 'Conferência do forro {local}. Vamos lá.'],
    itens: [
      { id: 'esperas', txt: 'Esperas de elétrica, hidráulica e ar-condicionado posicionadas antes do fechamento', chaves: ['espera', 'esperas', 'pontos de luz', 'ponto de luz', 'ponto eletrico', 'pontos eletricos'],
        perguntas: ['As esperas de elétrica, hidráulica e ar estão todas posicionadas?', 'Antes de fechar: as esperas ficaram todas no lugar?', 'Começando pelas esperas: elétrica, hidráulica e ar, tudo posicionado?'] },
      { id: 'estrutura', txt: 'Estrutura (tirantes e perfis) fixada e alinhada', chaves: ['estrutura', 'tirante', 'tirantes', 'perfil', 'perfis', 'canaleta'], critico: true,
        perguntas: ['A estrutura está firme? Tirantes e perfis fixados e alinhados?', 'E a estrutura, tirantes e perfis bem fixados?', 'Os tirantes e perfis estão firmes e alinhados?'] },
      { id: 'nivel', tipo: 'medida', unidade: 'mm', max: 5, txt: 'Desnível do forro (máx. 5 mm)', chaves: ['nivel', 'desnivel', 'nivelamento', 'nivelado'], critico: true,
        perguntas: ['Passou o nível? Quanto deu de desnível?', 'Qual foi o desnível do forro?', 'E o nivelamento, quantos milímetros deu de diferença?'] },
      { id: 'juntas', txt: 'Juntas tratadas, sem trincas ou fissuras', chaves: ['junta', 'juntas', 'fita', 'trinca', 'trincas', 'fissura', 'fissuras', 'emenda', 'emendas'],
        perguntas: ['As juntas estão tratadas, sem trinca?', 'E as emendas, tudo tratado sem fissura?', 'As juntas estão sem trinca?'] },
      { id: 'alcapao', txt: 'Alçapão de inspeção instalado, alinhado e abrindo', chaves: ['alcapao', 'alcapoes', 'inspecao', 'visita'],
        perguntas: ['O alçapão de inspeção está instalado e abrindo direitinho?', 'E o alçapão, no lugar e funcionando?', 'O alçapão abre e fecha bem?'] },
      { id: 'tabica', txt: 'Tabica / acabamento no encontro com a parede', chaves: ['tabica', 'tabicas', 'encontro', 'acabamento', 'cantoneira'],
        perguntas: ['A tabica no encontro com a parede está boa?', 'E o acabamento junto à parede, tabica certinha?', 'Encontro do forro com a parede, tudo bem acabado?'] },
      { id: 'recortes', txt: 'Recortes para luminárias e grelhas conforme projeto', chaves: ['recorte', 'recortes', 'luminaria', 'luminarias', 'spot', 'spots', 'grelha', 'grelhas', 'difusor'],
        perguntas: ['Os recortes de luminária e grelha estão no lugar certo do projeto?', 'E os recortes pros spots e grelhas, conferem com o projeto?'] },
      { id: 'limpeza', txt: 'Superfície limpa, sem manchas e pronta para pintura', chaves: ['limpeza', 'limpo', 'mancha', 'manchas', 'superficie', 'pintura'],
        perguntas: ['Por fim, a superfície está limpa e pronta pra pintura?', 'Tá tudo limpo, sem mancha, pronto pra pintar?'] }
    ]
  },
  {
    id: 'porta-madeira', nome: 'Porta de madeira (exemplo)', servico: 'Esquadrias', oficio: 'Carpinteiro', tipo: 'Porta',
    intro: ['Vamos conferir as portas {local}.', 'Conferência das portas {local}. Bora.'],
    itens: [
      { id: 'largura', tipo: 'medida', unidade: 'cm', min: 89.5, max: 90.5, txt: 'Largura do vão da folha (90 cm ± 0,5)', chaves: ['largura', 'vao', 'abertura'], critico: true,
        perguntas: ['Qual a largura da porta?', 'Mediu a largura? Quanto deu?', 'Começando pela largura do vão: quanto deu?'] },
      { id: 'prumo', tipo: 'medida', unidade: 'mm', max: 3, txt: 'Prumo do batente (máx. 3 mm)', chaves: ['prumo', 'aprumad', 'esquadro'], critico: true,
        perguntas: ['E o prumo do batente, quantos milímetros fora?', 'Quanto deu no prumo?'] },
      { id: 'batente', txt: 'Batente fixado, sem folgas e sem frestas na parede', chaves: ['batente', 'batentes', 'marco', 'fresta', 'frestas'],
        perguntas: ['O batente está bem fixado, sem fresta na parede?', 'Batente firme e sem folga?'] },
      { id: 'folha', txt: 'Folha abrindo e fechando sem raspar', chaves: ['folha', 'raspando', 'raspar', 'abre', 'fecha', 'abrindo', 'fechando'],
        perguntas: ['A porta abre e fecha sem raspar?', 'A folha está correndo bem, sem raspar no piso?'] },
      { id: 'ferragens', txt: 'Dobradiças e fechadura funcionando', chaves: ['dobradica', 'dobradicas', 'fechadura', 'macaneta', 'trinco', 'chave', 'ferragem', 'ferragens'],
        perguntas: ['Dobradiças e fechadura funcionando?', 'E as ferragens, fechadura e dobradiça ok?'] },
      { id: 'guarnicao', txt: 'Guarnições alinhadas e sem danos', chaves: ['guarnicao', 'guarnicoes', 'alizar', 'alizares', 'vista', 'vistas'],
        perguntas: ['As guarnições estão alinhadas e sem dano?', 'Guarnição certinha, sem batida?'] }
    ]
  }
];
