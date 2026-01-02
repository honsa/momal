<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerBinaryDrawTest extends TestCase
{
    public function testBinaryStrokeIsAcceptedAndBroadcastAsBinary(): void
    {
        $clock = 1000.0;
        $server = new MomalServer(
            new Words(['WORT']),
            new HighscoreStore($this->tmpHighscoreFile()),
            static fn (): float => $clock
        );

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

        $frame = $this->packStrokeFrame(seq: 42, tsMs: 123456, rgb: [20, 30, 40], widthPx: 4.5, points: [
            [0.1, 0.2],
            [0.2, 0.3],
            [0.25, 0.33],
        ]);

        $server->onMessage($drawer, $frame);

        // Both clients should receive at least one binary frame.
        self::assertNotEmpty($c1->sentBinary);
        self::assertNotEmpty($c2->sentBinary);

        $bin = $c1->sentBinary[array_key_last($c1->sentBinary)];
        self::assertIsString($bin);
        self::assertSame('MOML', substr($bin, 0, 4));
        self::assertSame(1, ord($bin[4])); // version
        self::assertSame(1, ord($bin[5])); // type

        $seq = unpack('V', substr($bin, 6, 4));
        self::assertSame(42, (int)$seq[1]);

        $n = unpack('v', substr($bin, 20, 2));
        self::assertSame(3, (int)$n[1]);

        // and server still emits JSON draw:batch for compatibility
        $batch1 = $this->findJsonByType($c1, 'draw:batch');
        $batch2 = $this->findJsonByType($c2, 'draw:batch');
        self::assertNotNull($batch1);
        self::assertNotNull($batch2);
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
