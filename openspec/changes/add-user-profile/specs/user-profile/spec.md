# Spec Delta

## Purpose

Define a identidade visível do usuário no ontarget: o menu de perfil no canto direito da
barra do aplicativo, a página de conta, o nome de exibição, a foto de perfil e as preferências
de aparência guardadas na conta.

## ADDED Requirements

### Requirement: Menu de perfil na barra do aplicativo
O sistema SHALL exibir no canto direito da barra do aplicativo um botão de perfil com a foto
do usuário (ou as iniciais, quando não houver foto) e, ao ser acionado, um menu com nome,
e-mail e os atalhos para conta, chaves de API e sair.

#### Scenario: Abrir o menu
- **WHEN** o usuário aciona o botão de perfil
- **THEN** o menu abre abaixo do botão mostrando nome, e-mail e as ações disponíveis

#### Scenario: Fechar o menu
- **WHEN** o menu está aberto e o usuário clica fora dele ou pressiona `Esc`
- **THEN** o menu fecha sem executar nenhuma ação e o foco volta ao botão de perfil

#### Scenario: Navegação por teclado
- **WHEN** o usuário percorre a barra do aplicativo apenas com teclado
- **THEN** o botão de perfil é alcançável por `Tab`, abre com `Enter` ou `Espaço` e as ações são percorríveis com as setas

### Requirement: Nome de exibição editável
O sistema SHALL permitir alterar o nome de exibição na página de conta, aceitando de 1 a 200
caracteres após remover espaços nas pontas, e SHALL manter o e-mail somente leitura.

#### Scenario: Nome atualizado
- **WHEN** o usuário altera o nome e salva
- **THEN** o novo nome aparece no menu de perfil e na página de conta

#### Scenario: Nome vazio
- **WHEN** o usuário tenta salvar um nome vazio ou só com espaços
- **THEN** a alteração é recusada com aviso e o nome anterior permanece

### Requirement: Foto de perfil com recorte
O sistema SHALL permitir enviar uma foto, recortá-la antes de salvar, substituí-la e removê-la.
O sistema SHALL aceitar PNG, JPEG, WebP, GIF, AVIF e BMP, recusar arquivos acima de 5 MB e
manter o avatar por iniciais como alternativa quando não houver foto.

#### Scenario: Foto enviada
- **WHEN** o usuário escolhe uma imagem válida, ajusta o recorte e confirma
- **THEN** a foto é salva e passa a aparecer no botão de perfil e na página de conta

#### Scenario: Arquivo inválido
- **WHEN** o arquivo escolhido não é uma imagem aceita ou excede 5 MB
- **THEN** o envio é recusado com aviso e a foto anterior é preservada

#### Scenario: Remover foto
- **WHEN** o usuário remove a foto existente
- **THEN** o perfil volta a exibir as iniciais do nome

### Requirement: Página de conta
O sistema SHALL oferecer uma página de conta, alcançável pelo menu de perfil, reunindo em
seções identificáveis o perfil, a senha, a aparência e as chaves de API.

#### Scenario: Abrir a conta pelo menu
- **WHEN** o usuário escolhe a opção de conta no menu de perfil
- **THEN** a página de conta abre com as quatro seções e o menu se fecha

### Requirement: Aparência guardada na conta
O sistema SHALL guardar tema, densidade e paleta na conta do usuário, aplicar a preferência
salva ao entrar em qualquer navegador e manter a última preferência disponível para o próximo
carregamento sem esperar a resposta do servidor.

#### Scenario: Preferência aplicada em outro navegador
- **WHEN** o usuário entra com a mesma conta em outro navegador
- **THEN** o tema, a densidade e a paleta salvos são aplicados sem nova escolha

#### Scenario: Preferência aplicada no carregamento
- **WHEN** o usuário recarrega uma página já autenticada
- **THEN** a aparência salva é aplicada antes de a página terminar de carregar

#### Scenario: Falha ao salvar preferência
- **WHEN** a atualização da preferência falha no servidor
- **THEN** o aviso informa a falha e a aparência anterior é restaurada
