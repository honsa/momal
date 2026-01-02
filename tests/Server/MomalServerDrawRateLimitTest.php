<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerDrawRateLimitTest extends TestCase
{
    public function testDrawEventsAreRateLimitedPerDrawer(): void
    {
        $ms = 0.0;
        $clock = static function () use (&$ms): float {
            return $ms;
        };

        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()), $clock);

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findLastJsonByType($c1, 'round:started');
        self::assertNotNull($started);
        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        $drawer = $drawerId === '1' ? $c1 : $c2;
        $receiver = $drawerId === '1' ? $c2 : $c1;

        $payload = ['t' => 'line', 'x0' => 0.1, 'y0' => 0.2, 'x1' => 0.3, 'y1' => 0.4, 'c' => '#000', 'w' => 3];

        // burst draw events - advance time a little
        for ($i = 0; $i < 10; $i++) {
            $server->onMessage($drawer, $this->json(['type' => 'draw:event', 'payload' => $payload]));
            $ms += $i === 0 ? 0 : 5;
        }

        $drawEvents = $this->countByType($receiver, 'draw:event');

        // With 10ms rate limit and 5ms increments, we expect 5 events (at t=0,10,20,30,40).
        self::assertSame(5, $drawEvents);
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

    private function countByType(FakeConnection $conn, string $type): int
    {
        $n = 0;
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                $n++;
            }
        }

        return $n;
    }
}
