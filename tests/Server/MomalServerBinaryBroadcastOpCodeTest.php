<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;
use Ratchet\RFC6455\Messaging\Frame;

final class MomalServerBinaryBroadcastOpCodeTest extends TestCase
{
    public function testBinaryBroadcastUsesOpBinaryFrames(): void
    {
        $clock = 1000.0;
        $server = new MomalServer(
            new Words(['WORT']),
            new HighscoreStore($this->tmpHighscoreFile()),
            static fn (): float => $clock
        );

        $c1 = new FakeWsConnection(1);
        $c2 = new FakeWsConnection(2);

        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findJsonByType($c1, 'round:started');
        self::assertNotNull($started);

        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        $drawer = $drawerId === '1' ? $c1 : $c2;
        $receiver = $drawerId === '1' ? $c2 : $c1;

        // Send a binary stroke frame to trigger binary broadcast.
        $bin = $this->packStrokeFrame(seq: 42, tsMs: 123456, rgb: [10, 20, 30], widthPx: 4.0, points: [
            [0.1, 0.1],
            [0.2, 0.2],
        ]);

        $server->onMessage($drawer, $bin);

        // We must at least deliver an OP_BINARY frame to the other player.
        self::assertNotEmpty($receiver->sentFrames, 'Expected at least one outgoing Frame for receiver');

        $last = $receiver->sentFrames[array_key_last($receiver->sentFrames)];
        self::assertSame(Frame::OP_BINARY, $last->getOpcode());
    }

    /** @param list<array{0:float,1:float}> $points */
    private function packStrokeFrame(int $seq, int $tsMs, array $rgb, float $widthPx, array $points): string
    {
        $count = count($points);
        $w10 = (int)round($widthPx * 10);

        $header = 'MOML'
            . chr(1) // version
            . chr(1) // type stroke
            . pack('V', $seq)
            . pack('V', $tsMs)
            . chr((int)$rgb[0])
            . chr((int)$rgb[1])
            . chr((int)$rgb[2])
            . chr(0)
            . pack('v', $w10)
            . pack('v', $count);

        $body = '';
        foreach ($points as $p) {
            $body .= pack('g', (float)$p[0]);
            $body .= pack('g', (float)$p[1]);
        }

        return $header . $body;
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
    private function findJsonByType(FakeWsConnection $conn, string $type): ?array
    {
        foreach ($conn->sentJson as $raw) {
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
}
