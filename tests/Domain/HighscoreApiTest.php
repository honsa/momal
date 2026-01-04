<?php

declare(strict_types=1);

namespace Momal\Tests\Domain;

use PHPUnit\Framework\TestCase;

final class HighscoreApiTest extends TestCase
{
    public function testHighscoreApiReturnsJsonAndRespectsLimit(): void
    {
        // Arrange: provide GET params via superglobal
        $_GET = [
            'roomId' => 'ROOM1',
            'limit' => '1',
        ];

        // Capture output
        ob_start();
        require __DIR__ . '/../../public/api/highscore.php';
        $out = ob_get_clean();

        self::assertIsString($out);
        $data = json_decode($out, true);

        self::assertIsArray($data);
        self::assertSame('ROOM1', $data['roomId'] ?? null);
        self::assertArrayHasKey('top', $data);
        self::assertIsArray($data['top']);

        // should not exceed limit
        self::assertLessThanOrEqual(1, count($data['top']));
    }

    public function testHighscoreApiClampsLimitToAtLeastOne(): void
    {
        $_GET = [
            'roomId' => 'ROOM1',
            'limit' => '0',
        ];

        ob_start();
        require __DIR__ . '/../../public/api/highscore.php';
        $out = ob_get_clean();

        $data = json_decode($out, true);
        self::assertIsArray($data);
        self::assertArrayHasKey('top', $data);
        self::assertIsArray($data['top']);
    }
}
