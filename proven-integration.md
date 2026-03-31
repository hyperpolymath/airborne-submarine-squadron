# Proven Integration for Airborne Submarine Squadron

## Overview
This document describes how the Airborne Submarine Squadron game integrates with the proven-servers infrastructure.

## Proven-Gameserver Integration

### Protocol Mapping

#### Game State → Proven Packet Types

| Game Concept | Proven PacketType | Direction | Purpose |
|--------------|-------------------|-----------|---------|
| Initial state | `Sync` | Server→Client | Full game state synchronisation |
| Player input | `Input` | Client→Server | Thrust, fire, toggle_env commands |
| State updates | `StateUpdate` | Server→Client | Deterministic state after each tick |
| Collision events | `Event` | Server→Client | Hit detection, scoring |
| Mission status | `Event` | Server→Client | Objective completion/failure |
| Ping/latency | `Ping`/`Pong` | Both | Network latency measurement |

#### Game State → Proven GameState

| Game Phase | Proven GameState |
|------------|------------------|
| Loading | `Waiting` |
| Countdown | `Starting` |
| Playing | `Running` |
| Paused | `Paused` |
| Mission complete | `Ending` |
| Game over | `Finished` |

#### Player → Proven PlayerState

| Player Status | Proven PlayerState |
|---------------|-------------------|
| Connecting | `Connecting` |
| In lobby | `Lobby` |
| Playing | `InGame` |
| Spectating | `Spectating` |
| Disconnected | `Disconnected` |

### Network Architecture

```
Client Browser → Proven-Server (Deno) → Game Logic (WASM)
    ↑                                      ↓
    └────────────────────────────────────┘
          Deterministic State Sync
```

### Synchronisation Strategy

- **Strategy**: `ServerAuth` (Server-authoritative)
- **Implementation**: WASM executes deterministic simulation on server
- **Client role**: Renders state, sends inputs, receives updates
- **Tick rate**: 60 ticks/sec (matches browser refresh rate)

### Data Flow

1. **Client connects** → `Connect` packet
2. **Server responds** → `Sync` packet with full state
3. **Game loop**:
   - Client sends `Input` packets (60Hz)
   - Server processes inputs, runs WASM step
   - Server broadcasts `StateUpdate` to all clients
   - Server sends `Event` packets for game events
4. **Disconnect** → `Disconnect` packet with reason

### State Representation

The game state is represented as a flat array of 30 integers:

```
[
  29,                    // Length (always 29 data elements)
  tick,                  // Current game tick
  env,                   // Environment (0=air, 1=water)
  sub_x, sub_y, sub_vx, sub_vy, sub_health,  // Submarine state
  ammo, cooldown,        // Weapons state
  proj_a_active, proj_a_x, proj_a_y,  // Projectile A
  proj_b_active, proj_b_x, proj_b_y,  // Projectile B
  enemy_a_active, enemy_a_x, enemy_a_y, enemy_a_health,  // Enemy A
  enemy_b_active, enemy_b_x, enemy_b_y, enemy_b_health,  // Enemy B
  score, kills,          // Scoring
  mission_kills_needed, mission_max_ticks, mission_completed, mission_failed  // Mission
]
```

### Input Format

Client inputs are sent as a structured object:

```typescript
{
  thrust_x: number;    // -2 to 2
  thrust_y: number;    // -2 to 2  
  fire: boolean;      // Primary weapon
  fire_alt: boolean;  // Secondary weapon
  toggle_env: boolean; // Switch air/water
  timestamp: number;  // Client timestamp
}
```

### Error Handling

| Condition | Response |
|-----------|----------|
| Invalid packet | `Disconnect` with `Error` reason |
| Cheating detected | `Disconnect` with `Kicked` reason |
| Network timeout | `Disconnect` with `Timeout` reason |
| Server shutdown | `Disconnect` with `ServerShutdown` reason |

## Implementation Status

- [x] Core game logic in AffineScript/WASM
- [x] Deterministic simulation
- [x] State serialisation/deserialisation
- [x] Basic proven-server integration
- [ ] Full proven-gameserver protocol implementation
- [ ] Multiplayer support
- [ ] Anti-cheat validation
- [ ] Comprehensive error handling

## Next Steps

1. Implement proven PacketType serialisation in WASM
2. Add network layer to game client
3. Implement server-side game loop with proven protocol
4. Add multiplayer support and synchronisation
5. Implement anti-cheat validation
6. Add comprehensive logging and metrics

## Testing

### Unit Tests
- State serialisation/deserialisation
- Deterministic simulation
- Input validation
- Collision detection

### Integration Tests
- Client-server connection
- State synchronisation
- Input processing
- Event handling

### End-to-End Tests
- Full mission completion
- Multiplayer session
- Network latency handling
- Error conditions

## Performance Considerations

- **State size**: 30 ints × 4 bytes = 120 bytes per update
- **Bandwidth**: 120 bytes × 60 Hz = 7.2 KB/sec per client
- **Latency**: Target < 100ms for smooth gameplay
- **Server capacity**: ~1000 clients on moderate hardware

## Security Considerations

- Input validation on server
- Anti-cheat detection
- Rate limiting
- Authentication (future)
- Encryption (future)

## Compliance

This integration follows proven-servers patterns:
- Deterministic state management
- Explicit error handling
- Type-safe protocols
- Safety-first design
