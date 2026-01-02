<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerRateLimitEnvTest extends TestCase
{
    protected function tearDown(): void
    {
        // Reset env after each test to avoid cross-test pollution.
        putenv('MOMAL_CHAT_RATE_LIMIT_MS');
        putenv('MOMAL_DRAW_RATE_LIMIT_MS');
    }

    public function testChatRateLimitCanBeDisabledViaEnv(): void
    {
        putenv('MOMAL_CHAT_RATE_LIMIT_MS=0');
        putenv('MOMAL_DRAW_RATE_LIMIT_MS=0');

        $ms = 0.0;
        $server = $this->serverWithClock($ms, ['A']);

        [$c1, $c2] = $this->joinRoom($server);

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($c1, $this->json(['type' => 'chat', 'text' => 'msg ' . $i]));
        }

        self::assertSame(5, $this->countNonSystemChat($c2));
    }

    public function testChatRateLimitRejectsNegativeEnvValue(): void
    {
        putenv('MOMAL_CHAT_RATE_LIMIT_MS=-10');
        putenv('MOMAL_DRAW_RATE_LIMIT_MS=0');

        $ms = 0.0;
        $server = $this->serverWithClock($ms, ['A']);

        [$c1, $c2] = $this->joinRoom($server);

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($c1, $this->json(['type' => 'chat', 'text' => 'msg ' . $i]));
        }

        // default limiter should kick in
        self::assertSame(1, $this->countNonSystemChat($c2));
    }

    public function testDrawRateLimitCanBeDisabledViaEnv(): void
    {
        putenv('MOMAL_DRAW_RATE_LIMIT_MS=0');

        $ms = 0.0;
        $server = $this->serverWithClock($ms, ['WORT']);

        [$c1, $c2] = $this->joinRoom($server);
        [$drawer, $receiver] = $this->startRoundAndGetDrawerReceiver($server, $c1, $c2);

        $payload = ['t' => 'line', 'x0' => 0.1, 'y0' => 0.2, 'x1' => 0.3, 'y1' => 0.4, 'c' => '#000', 'w' => 3];

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($drawer, $this->json(['type' => 'draw:event', 'payload' => $payload]));
        }

        self::assertSame(5, $this->countByType($receiver, 'draw:event'));
    }

    public function testDrawRateLimitRejectsNegativeEnvValue(): void
    {
        putenv('MOMAL_DRAW_RATE_LIMIT_MS=-10');

        $ms = 0.0;
        $server = $this->serverWithClock($ms, ['WORT']);

        [$c1, $c2] = $this->joinRoom($server);
        [$drawer, $receiver] = $this->startRoundAndGetDrawerReceiver($server, $c1, $c2);

        $payload = ['t' => 'line', 'x0' => 0.1, 'y0' => 0.2, 'x1' => 0.3, 'y1' => 0.4, 'c' => '#000', 'w' => 3];

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($drawer, $this->json(['type' => 'draw:event', 'payload' => $payload]));
        }

        // Default draw limiter is disabled (0ms), negative values must fall back to default (also disabled).
        self::assertSame(5, $this->countByType($receiver, 'draw:event'));
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

    private function countNonSystemChat(FakeConnection $conn): int
    {
        $n = 0;
        foreach ($conn->sent as $raw) {
            $d = json_decode($raw, true);
            if (!is_array($d) || ($d['type'] ?? null) !== 'chat:new') {
                continue;
            }
            if (($d['name'] ?? '') !== 'System') {
                $n++;
            }
        }

        return $n;
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

    /** @param list<string> $words */
    private function serverWithClock(float &$ms, array $words): MomalServer
    {
        $clock = static fn (): float => $ms;

        return new MomalServer(new Words($words), new HighscoreStore($this->tmpHighscoreFile()), $clock);
    }

    /** @return array{FakeConnection, FakeConnection} */
    private function joinRoom(MomalServer $server): array
    {
        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        return [$c1, $c2];
    }

    /** @return array{FakeConnection, FakeConnection} */
    private function startRoundAndGetDrawerReceiver(MomalServer $server, FakeConnection $c1, FakeConnection $c2): array
    {
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findLastJsonByType($c1, 'round:started');
        self::assertNotNull($started);

        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        $drawer = $drawerId === '1' ? $c1 : $c2;
        $receiver = $drawerId === '1' ? $c2 : $c1;

        return [$drawer, $receiver];
    }
}
