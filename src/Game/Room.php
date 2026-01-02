<?php

declare(strict_types=1);

namespace Momal\Game;

use Momal\Domain\Words;

final class Room
{
    public string $id;

    /** @var array<string, Player> connectionId => Player */
    public array $players = [];

    public ?string $hostConnectionId = null;

    public string $state = 'lobby'; // lobby|in_round|round_end

    public ?string $drawerConnectionId = null;
    public ?string $word = null;

    public int $roundStartedAt = 0;
    public int $roundDurationSec = 80;

    /** @var array<string,bool> */
    public array $guessed = []; // connectionId => true

    public int $roundNumber = 0;

    public function __construct(string $id)
    {
        $this->id = $id;
    }

    public function addPlayer(Player $player): void
    {
        $this->players[$player->connectionId] = $player;
        if ($this->hostConnectionId === null) {
            $this->hostConnectionId = $player->connectionId;
        }
    }

    public function removePlayer(string $connectionId): void
    {
        unset($this->players[$connectionId]);
        unset($this->guessed[$connectionId]);
        if ($this->hostConnectionId === $connectionId) {
            $this->hostConnectionId = \array_key_first($this->players) ?: null;
        }
        if ($this->drawerConnectionId === $connectionId) {
            $this->drawerConnectionId = null;
            $this->word = null;
            $this->state = 'lobby';
        }
    }

    public function isEmpty(): bool
    {
        return \count($this->players) === 0;
    }

    public function startRound(Words $words): void
    {
        if (\count($this->players) < 2) {
            return;
        }

        $this->roundNumber++;
        $this->state = 'in_round';
        $this->guessed = [];

        $this->drawerConnectionId = $this->pickNextDrawer();
        $this->word = $words->randomWord();
        $this->roundStartedAt = \time();

        // everybody is allowed to guess except drawer
        if ($this->drawerConnectionId !== null) {
            $this->guessed[$this->drawerConnectionId] = true; // mark as already "guessed" for scoring
        }
    }

    private function pickNextDrawer(): ?string
    {
        $ids = \array_keys($this->players);
        if ($ids === []) {
            return null;
        }

        if ($this->drawerConnectionId === null) {
            return $ids[0];
        }

        $idx = \array_search($this->drawerConnectionId, $ids, true);
        if ($idx === false) {
            return $ids[0];
        }

        $next = $idx + 1;
        if ($next >= \count($ids)) {
            $next = 0;
        }
        return $ids[$next];
    }

    public function timeLeft(): int
    {
        if ($this->state !== 'in_round') {
            return 0;
        }
        $elapsed = \time() - $this->roundStartedAt;
        return \max(0, $this->roundDurationSec - $elapsed);
    }

    public function allGuessersDone(): bool
    {
        if ($this->drawerConnectionId === null) {
            return true;
        }
        foreach ($this->players as $cid => $_p) {
            if ($cid === $this->drawerConnectionId) {
                continue;
            }
            if (!isset($this->guessed[$cid])) {
                return false;
            }
        }
        return true;
    }
}

