<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use Momal\Server\OriginCheckingWsServer;
use Momal\Server\SecurityConfig;
use Ratchet\Http\HttpServer;
use Ratchet\Server\IoServer;
use React\EventLoop\Loop;
use React\Socket\SocketServer;

$host = getenv('MOMAL_WS_HOST') ?: '0.0.0.0';
$port = (int)(getenv('MOMAL_WS_PORT') ?: 8080);

$words = new Words();

// Legacy dependency for backwards-compat only; per-room highscores use RoomHighscoreStore internally.
$legacyHighscore = new HighscoreStore(__DIR__ . '/../var/highscore-legacy.json');

$app = new MomalServer($words, $legacyHighscore);

$allowedOrigins = SecurityConfig::allowedWsOrigins();

// Create a shared loop so we can run a reliable 1s tick for timers.
$loop = Loop::get();
$loop->addPeriodicTimer(1.0, static function () use ($app): void {
    $app->tick();
});

$socket = new SocketServer("{$host}:{$port}", [], $loop);
$server = new IoServer(
    new HttpServer(
        new OriginCheckingWsServer($app, $allowedOrigins)
    ),
    $socket,
    $loop
);

echo "Momal WebSocket server listening on ws://{$host}:{$port}\n";
$server->run();
