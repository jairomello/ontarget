# Spec Delta

## ADDED Requirements

### Requirement: Paletas de cor
O sistema SHALL oferecer, além do modo claro/escuro/automático, um conjunto de paletas de
cor nomeadas que alteram os tons de destaque e de superfície, aplicando a paleta a toda a
interface sem recarregar e mantendo o contraste mínimo exigido pelo tema.

#### Scenario: Troca de paleta
- **WHEN** o usuário escolhe outra paleta de cor
- **THEN** a interface inteira adota os novos tons imediatamente, sem perder seleção, zoom ou rolagem

#### Scenario: Paleta em tema automático
- **WHEN** o tema está em automático e o sistema operacional alterna entre claro e escuro
- **THEN** a paleta escolhida continua aplicada nos dois modos

#### Scenario: Contraste preservado
- **WHEN** qualquer paleta é combinada com o tema claro ou escuro
- **THEN** texto e elementos gráficos mantêm o contraste mínimo de 4,5:1 e 3:1

### Requirement: Controles de aparência no perfil
O sistema SHALL oferecer tema, densidade e paleta dentro do menu de perfil e da página de
conta, mantendo a troca imediata e a persistência já exigidas para a aparência.

#### Scenario: Ajuste rápido pelo menu
- **WHEN** o usuário abre o menu de perfil em um projeto aberto
- **THEN** consegue trocar tema, densidade e paleta sem sair da tela e sem perder o estado do projeto

#### Scenario: Barra superior sem duplicação
- **WHEN** o usuário observa a barra do aplicativo
- **THEN** os seletores de tema e densidade não aparecem mais duplicados fora do menu de perfil
