<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerTest extends TestCase
{
    public function testHelloOnOpenReturnsConnectionId(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $server->onOpen($c1);

        $msg = $this->lastJson($c1);
        self::assertSame('hello', $msg['type'] ?? null);
        self::assertSame('1', $msg['connectionId'] ?? null);
    }

    public function testJoinBroadcastsSystemAndSnapshot(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'abc123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'abc123']));

        // joined ack
        $joined1 = $this->findJsonByType($c1, 'joined');
        self::assertSame('ABC123', $joined1['roomId'] ?? null);
        self::assertTrue((bool)($joined1['isHost'] ?? false));

        $joined2 = $this->findJsonByType($c2, 'joined');
        self::assertSame('ABC123', $joined2['roomId'] ?? null);
        self::assertFalse((bool)($joined2['isHost'] ?? true));

        // both should get snapshots
        self::assertNotNull($this->findJsonByType($c1, 'room:snapshot'));
        self::assertNotNull($this->findJsonByType($c2, 'room:snapshot'));

        // system join messages should propagate
        $sys1 = $this->findJsonByType($c1, 'chat:new');
        self::assertSame('System', $sys1['name'] ?? null);
    }

    public function testRoundStartSendsSecretWordOnlyToDrawer(): void
    {
        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        // host starts
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findJsonByType($c1, 'round:started');
        self::assertNotNull($started);
        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        self::assertContains($drawerId, ['1', '2']);

        $wordForC1 = $this->findJsonByType($c1, 'round:word');
        $wordForC2 = $this->findJsonByType($c2, 'round:word');

        // Exactly one of them must receive the secret word.
        self::assertNotSame($wordForC1 !== null, $wordForC2 !== null);

        if ($drawerId === '1') {
            self::assertSame('WORT', $wordForC1['word'] ?? null);
            self::assertNull($wordForC2);
        } else {
            self::assertSame('WORT', $wordForC2['word'] ?? null);
            self::assertNull($wordForC1);
        }
    }

    public function testDrawEventOnlyBroadcastsFromDrawerDuringRound(): void
    {
        $server = new MomalServer(new Words(['WORT']), new HighscoreStore($this->tmpHighscoreFile()), static fn (): float => 1000.0);

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
        $guesser = $drawerId === '1' ? $c2 : $c1;

        $payload = ['t' => 'line', 'x0' => 0.1, 'y0' => 0.2, 'x1' => 0.3, 'y1' => 0.4, 'c' => '#000', 'w' => 3];

        // Guesser tries to draw -> ignored (no broadcast)
        $server->onMessage($guesser, $this->json(['type' => 'draw:event', 'payload' => $payload]));
        self::assertNull($this->findJsonByType($guesser, 'draw:batch'));

        // Drawer draws -> broadcast (as draw:batch)
        $server->onMessage($drawer, $this->json(['type' => 'draw:event', 'payload' => $payload]));
        self::assertNotNull($this->findJsonByType($c1, 'draw:batch'));
        self::assertNotNull($this->findJsonByType($c2, 'draw:batch'));
    }

    public function testJoinRejectsDuplicatePlayerNamesInSameRoom(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'ALICE', 'roomId' => 'ABC123']));

        self::assertNotNull($this->findJsonByType($c1, 'joined'));

        $err = $this->findJsonByType($c2, 'error');
        self::assertNotNull($err);
        self::assertStringContainsString('vergeben', (string)($err['message'] ?? ''));

        self::assertNull($this->findJsonByType($c2, 'joined'));
    }

    private function tmpHighscoreFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/highscore-' . uniqid('', true) . '.json';
    }

    /** @return array<string,mixed> */
    private function lastJson(FakeConnection $conn): array
    {
        self::assertNotEmpty($conn->sent);

        return (array)json_decode($conn->sent[array_key_last($conn->sent)], true);
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

    /** @param array<string,mixed> $data */
    private function json(array $data): string
    {
        $encoded = json_encode($data);
        self::assertIsString($encoded);

        return $encoded;
    }
}
