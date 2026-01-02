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

        $ms = 0.0;
        $clock = static fn () => $ms;

        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()), $clock);

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($c1, $this->json(['type' => 'chat', 'text' => 'msg ' . $i]));
        }

        $nonSystem = $this->countNonSystemChat($c2);
        self::assertSame(5, $nonSystem);
    }

    public function testChatRateLimitRejectsNegativeEnvValue(): void
    {
        putenv('MOMAL_CHAT_RATE_LIMIT_MS=-10');

        $ms = 0.0;
        $clock = static fn () => $ms;

        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()), $clock);

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($c1, $this->json(['type' => 'chat', 'text' => 'msg ' . $i]));
        }

        // default limiter should kick in
        $nonSystem = $this->countNonSystemChat($c2);
        self::assertSame(1, $nonSystem);
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
}
