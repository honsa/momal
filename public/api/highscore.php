<?php

declare(strict_types=1);

require __DIR__ . '/../../vendor/autoload.php';

use Momal\Domain\RoomHighscoreStore;

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$roomId = (string)($_GET['roomId'] ?? '');
$limit = (int)($_GET['limit'] ?? 20);
$limit = max(1, min(100, $limit));

$store = new RoomHighscoreStore(__DIR__ . '/../../var/highscore-by-room.json');

echo json_encode([
    'roomId' => $roomId,
    'top' => $store->top($roomId, $limit),
], JSON_UNESCAPED_UNICODE);
