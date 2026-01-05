<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerEdgeCasesTest extends TestCase
{
    public function testWhenDrawerLeavesMidRoundRoundEnds(): void
    {
        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findJsonByType($c1, 'round:started');
        self::assertNotNull($started);
        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        $drawer = $drawerId === '1' ? $c1 : $c2;

        // drawer disconnects
        $server->onClose($drawer);

        // remaining player should get round:ended
        $remaining = $drawerId === '1' ? $c2 : $c1;
        $ended = $this->findJsonByType($remaining, 'round:ended');
        self::assertNotNull($ended);
        self::assertArrayHasKey('word', $ended);
        self::assertIsString($ended['word']);
    }

    public function testWhenHostLeavesNewHostIsAssignedInSnapshot(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        // host leaves
        $server->onClose($c1);

        $snap = $this->findLastJsonByType($c2, 'room:snapshot');
        self::assertNotNull($snap);

        $players = (array)($snap['players'] ?? []);
        self::assertCount(1, $players);

        $bob = $players[0];
        self::assertSame('Bob', (string)($bob['name'] ?? ''));
        self::assertTrue((bool)($bob['isHost'] ?? false));
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
    private function findJsonByType(FakeConnection $conn, string $type): ?array
    {
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                return $decoded;
            }
        }

        return null;
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
