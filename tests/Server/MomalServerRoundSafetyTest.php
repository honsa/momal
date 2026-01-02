<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerRoundSafetyTest extends TestCase
{
    public function testRoomSwitchIsRejectedWhileInRound(): void
    {
        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        // try to switch room during round
        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ZZZ999']));

        $err = $this->findLastJsonByType($c1, 'error');
        self::assertNotNull($err);

        // still in old room snapshot
        $snap = $this->findLastJsonByType($c1, 'room:snapshot');
        self::assertNotNull($snap);
        self::assertSame('ABC123', (string)($snap['roomId'] ?? ''));
        self::assertSame('in_round', (string)($snap['state'] ?? ''));
    }

    public function testNameUpdateIsAllowedWhileInRound(): void
    {
        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        // update name in same room
        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice2', 'roomId' => 'ABC123']));

        $snap = $this->findLastJsonByType($c2, 'room:snapshot');
        self::assertNotNull($snap);

        $players = (array)($snap['players'] ?? []);
        $names = array_map(static fn ($p) => (string)($p['name'] ?? ''), $players);
        self::assertContains('Alice2', $names);
    }

    private function tmpHighscoreFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/highscore-' . uniqid('', true) . '.json';
    }

    /** @param array<string,mixed> $data */
    private function json(array $data): string
    {
        $encoded = json_encode($data);
        self::assertIsString($encoded);

        return $encoded;
    }

    /** @return array<string,mixed>|null */
    private function findLastJsonByType(FakeConnection $conn, string $type): ?array
    {
        $found = null;
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                $found = $decoded;
            }
        }

        return $found;
    }
}
