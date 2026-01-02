<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerMessageSizeLimitTest extends TestCase
{
    public function testOversizeTextMessageClosesConnection(): void
    {
        $prev = getenv('MOMAL_WS_MAX_TEXT_BYTES');
        putenv('MOMAL_WS_MAX_TEXT_BYTES=16');

        try {
            $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

            $c1 = new FakeConnection(1);
            $server->onOpen($c1);

            $server->onMessage($c1, str_repeat('x', 64));

            self::assertTrue($c1->closed, 'Connection should be closed on oversize text payload');
        } finally {
            if ($prev === false) {
                putenv('MOMAL_WS_MAX_TEXT_BYTES');
            } else {
                putenv('MOMAL_WS_MAX_TEXT_BYTES=' . $prev);
            }
        }
    }

    public function testOversizeBinaryMessageClosesConnection(): void
    {
        $prev = getenv('MOMAL_WS_MAX_BINARY_BYTES');
        putenv('MOMAL_WS_MAX_BINARY_BYTES=32');

        try {
            $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

            $c1 = new FakeConnection(1);
            $server->onOpen($c1);

            // Binary draw frames start with MOML; send a clearly oversize frame.
            $server->onMessage($c1, 'MOML' . str_repeat("\0", 128));

            self::assertTrue($c1->closed, 'Connection should be closed on oversize binary payload');
        } finally {
            if ($prev === false) {
                putenv('MOMAL_WS_MAX_BINARY_BYTES');
            } else {
                putenv('MOMAL_WS_MAX_BINARY_BYTES=' . $prev);
            }
        }
    }

    private function tmpHighscoreFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/highscore-' . uniqid('', true) . '.json';
    }
}
