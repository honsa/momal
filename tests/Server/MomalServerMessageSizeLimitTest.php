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
        putenv('MOMAL_WS_MAX_TEXT_BYTES=16');

        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $server->onOpen($c1);

        $server->onMessage($c1, str_repeat('x', 64));

        self::assertTrue($c1->closed, 'Connection should be closed on oversize payload');

        putenv('MOMAL_WS_MAX_TEXT_BYTES');
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
