# Stream Deck GitHub Action Status Plugin

## Commandes de développement

```bash
# Compiler le projet TypeScript
npm run build

# Installer le plugin dans Stream Deck
npm run install-plugin

# Build + Install en une commande
npm run build && npm run install-plugin
```

## Redémarrer Stream Deck après installation

```bash
taskkill //IM StreamDeck.exe //F; sleep 2; "/c/Program Files/Elgato/StreamDeck/StreamDeck.exe" &
```

## Structure du projet

- `src/` - Sources TypeScript
  - `plugin.ts` - Backend principal (gestion WebSocket, affichage)
  - `github-api.ts` - Appels API GitHub Actions
  - `types.ts` - Types TypeScript
- `com.music-maths.github-action-status.sdPlugin/` - Plugin compilé
  - `manifest.json` - Configuration du plugin
  - `images/` - Icônes SVG
  - `actions/workflow-status/property-inspector.html` - Interface de configuration

## Fonctionnalités

- Affiche le statut du dernier workflow GitHub Actions
- Icône colorée : vert (success), rouge (failure), jaune (pending), gris (unknown)
- Date du dernier run centrée en haut
- Clic court : rafraîchir le statut
- Clic long (>500ms) : ouvrir GitHub dans le navigateur
