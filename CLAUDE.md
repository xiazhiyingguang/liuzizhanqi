# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

六子战棋 (Six Chess Battle) — a turn-based tactical strategy game on a 6×6 board. Two players each select 4 heroes, deploy them, and take turns using skills to eliminate the opponent's heroes.

## Commands

### Frontend (root)
```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server on port 3000
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint with TypeScript/React rules
```

### Backend (server/)
```bash
cd server
npm install
npm run dev          # node --watch server.js (auto-restart)
npm start            # node server.js
```

### Docker
```bash
docker-compose up    # Starts backend (port 3000) + frontend nginx (port 80)
```

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand
- **Backend**: Express + Socket.IO (WebSocket multiplayer)
- **State**: Zustand store is the single source of truth for all game state

### Core Systems (src/core/)

| File | Responsibility |
|------|---------------|
| `game-engine.ts` | Turn management, hero revival, game flow control |
| `damage-calculator.ts` | Full damage pipeline: base → crit → defense → shield → vampire → counter |
| `skill-system.ts` | Skill targeting validation, range calculation, execution dispatch |
| `movement-system.ts` | Manhattan distance, area detection, position validation |
| `effect-manager.ts` | Add/remove/query buffs/debuffs, stack management (e.g. cold→stun at 3 stacks) |
| `passive-registry.ts` | Passive skill trigger registration |

### Data Layer (src/data/)
- `heroes.ts` — Hero templates, passive/tianwei skill implementations, clone factory (`createWukongClone`)
- `skills.ts` — Skill definitions with range, target type, damage, effects

### State Management (src/store/)
- `game-store.ts` — Zustand store containing all `GameState`. All UI interactions dispatch actions here. State updates must be immutable (deep clone arrays).

### Game Phases
The app renders different components based on `state.phase`:
`menu` → `online-menu` → `hero-select` → `deploy` → `battle` → `ended`

### Multiplayer Sync
- `src/services/socket-service.ts` — Socket.IO client, connects to `VITE_SERVER_URL` (default `http://localhost:8787`)
- `src/hooks/useOnlineSync.ts` — Syncs opponent actions via `action-broadcast` events
- Server (`server/server.js`) validates and broadcasts actions; sends periodic `game-state-update` snapshots

## Key Patterns

### Damage Flow
Always use `DamageCalculator.applyDamage()` — never modify `hero.currentHp` directly. The pipeline: base damage → crit roll → defense reduction → shield absorption → HP deduction → vampire heal → counter-attack check.

### Clone System (孙悟空/镜)
- Clones are identified by `hero.counters?.[__isClone] === 1`
- Clone IDs follow format: `wukong-clone|{ownerId}|{timestamp}|{random}`
- On hero death, all associated clones are purged from the board

### Cold/Freeze Stacking
Cold stacks managed in `effect-manager.ts` via `stackCount`. At 3 stacks, `DamageCalculator` auto-removes cold and adds stun.

### Passive Trigger Points
Passive logic must be explicitly called in:
- `DamageCalculator` — damage-related passives
- `MovementSystem` — movement-related passives
- `GameEngine.endHeroAction` — turn-end passives

### Online Action Dispatch
Any state mutation from player input must have a corresponding `sendOnlineActionIfNeeded` call to broadcast to the opponent.

## Adding a New Hero

1. Define template in `src/data/heroes.ts` with `name`, `maxHp`, `moveRange`, `baseAttack`, skill IDs, `passiveId`
2. Implement passive in `heroes.ts` and register in `passive-registry.ts`
3. Add skill definitions in `src/data/skills.ts`
4. If hero has complex mechanics (clones, counters), handle in `DamageCalculator` or `GameEngine`

## Environment

- `VITE_SERVER_URL` — Backend WebSocket URL (see `.env.example` for presets)
- Server port defaults to 8787 (configurable via `PORT` env var)

## Conventions

- `@typescript-eslint/no-explicit-any` is OFF — `any` is allowed
- `@typescript-eslint/no-unused-vars` is OFF
- `prefer-const` is OFF
- Position type is `[row, col]` tuple (not `{x, y}`)
- Board is 6×6, indexed `[0-5][0-5]`
- All Chinese strings in game UI (hero names, skill names, log messages)
