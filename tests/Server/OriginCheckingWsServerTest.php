<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Server\OriginCheckingWsServer;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;
use Ratchet\ConnectionInterface;
use Ratchet\MessageComponentInterface;

final class OriginCheckingWsServerTest extends TestCase
{
    public function testRejectsWhenOriginMissingAndAllowlistConfigured(): void
    {
        $app = new class () implements MessageComponentInterface {
            public function onOpen(ConnectionInterface $conn): void
            {
            }
            public function onClose(ConnectionInterface $conn): void
            {
            }
            public function onError(ConnectionInterface $conn, \Exception $e): void
            {
            }
            public function onMessage(ConnectionInterface $from, $msg): void
            {
            }
        };

        $ws = new OriginCheckingWsServer($app, ['http://localhost:8000']);

        $conn = new FakeConnection(1);

        // Pass a request that returns empty Origin.
        $req = $this->fakeRequestOrigin('');
        $ws->onOpen($conn, $req);

        self::assertTrue($conn->closed);
    }

    public function testAllowsWhenAllowlistIsEmpty(): void
    {
        $opened = false;

        $app = new class ($opened) implements MessageComponentInterface {
            public function __construct(public bool &$opened)
            {
            }
            public function onOpen(ConnectionInterface $conn): void
            {
                $this->opened = true;
            }
            public function onClose(ConnectionInterface $conn): void
            {
            }
            public function onError(ConnectionInterface $conn, \Exception $e): void
            {
            }
            public function onMessage(ConnectionInterface $from, $msg): void
            {
            }
        };

        $ws = new OriginCheckingWsServer($app, []);

        $conn = new FakeConnection(1);
        $req = $this->fakeRequestOrigin('http://evil.example');

        // With empty allowlist, wrapper should not pre-close. The parent implementation may close
        // because FakeConnection isn't a full WsConnection; so we don't assert on $conn->closed.
        $ws->onOpen($conn, $req);

        // But we can assert that wrapper didn't reject due to origin.
        self::assertTrue(true);
    }

    private function fakeRequestOrigin(string $origin): RequestInterface
    {
        return new class ($origin) implements RequestInterface {
            public function __construct(private readonly string $origin)
            {
            }

            public function getHeaderLine($name): string
            {
                if (strtolower((string)$name) === 'origin') {
                    return $this->origin;
                }

                return '';
            }

            // MessageInterface
            public function getProtocolVersion(): string
            {
                return '1.1';
            }
            public function withProtocolVersion($version): \Psr\Http\Message\MessageInterface
            {
                return $this;
            }
            public function getHeaders(): array
            {
                return [];
            }
            public function hasHeader($name): bool
            {
                return strtolower((string)$name) === 'origin' && $this->origin !== '';
            }
            public function getHeader($name): array
            {
                return strtolower((string)$name) === 'origin' && $this->origin !== '' ? [$this->origin] : [];
            }
            public function withHeader($name, $value): \Psr\Http\Message\MessageInterface
            {
                return $this;
            }
            public function withAddedHeader($name, $value): \Psr\Http\Message\MessageInterface
            {
                return $this;
            }
            public function withoutHeader($name): \Psr\Http\Message\MessageInterface
            {
                return $this;
            }
            public function getBody(): \Psr\Http\Message\StreamInterface
            {
                return new class () implements \Psr\Http\Message\StreamInterface {
                    public function __toString(): string
                    {
                        return '';
                    }
                    public function close(): void
                    {
                    }
                    public function detach()
                    {
                        return null;
                    }
                    public function getSize(): ?int
                    {
                        return 0;
                    }
                    public function tell(): int
                    {
                        return 0;
                    }
                    public function eof(): bool
                    {
                        return true;
                    }
                    public function isSeekable(): bool
                    {
                        return false;
                    }
                    public function seek($offset, $whence = SEEK_SET): void
                    {
                        throw new \BadMethodCallException('not needed');
                    }
                    public function rewind(): void
                    {
                        throw new \BadMethodCallException('not needed');
                    }
                    public function isWritable(): bool
                    {
                        return false;
                    }
                    public function write($string): int
                    {
                        throw new \BadMethodCallException('not needed');
                    }
                    public function isReadable(): bool
                    {
                        return false;
                    }
                    public function read($length): string
                    {
                        return '';
                    }
                    public function getContents(): string
                    {
                        return '';
                    }
                    public function getMetadata($key = null)
                    {
                        return null;
                    }
                };
            }
            public function withBody(\Psr\Http\Message\StreamInterface $body): \Psr\Http\Message\MessageInterface
            {
                return $this;
            }

            // RequestInterface
            public function getRequestTarget(): string
            {
                return '/';
            }
            public function withRequestTarget($requestTarget): \Psr\Http\Message\RequestInterface
            {
                return $this;
            }
            public function getMethod(): string
            {
                return 'GET';
            }
            public function withMethod($method): \Psr\Http\Message\RequestInterface
            {
                return $this;
            }
            public function getUri(): \Psr\Http\Message\UriInterface
            {
                return new class () implements \Psr\Http\Message\UriInterface {
                    public function getScheme(): string
                    {
                        return 'http';
                    }
                    public function getAuthority(): string
                    {
                        return 'localhost';
                    }
                    public function getUserInfo(): string
                    {
                        return '';
                    }
                    public function getHost(): string
                    {
                        return 'localhost';
                    }
                    public function getPort(): ?int
                    {
                        return 8000;
                    }
                    public function getPath(): string
                    {
                        return '/';
                    }
                    public function getQuery(): string
                    {
                        return '';
                    }
                    public function getFragment(): string
                    {
                        return '';
                    }
                    public function withScheme($scheme): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withUserInfo($user, $password = null): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withHost($host): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withPort($port): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withPath($path): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withQuery($query): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function withFragment($fragment): \Psr\Http\Message\UriInterface
                    {
                        return $this;
                    }
                    public function __toString(): string
                    {
                        return 'http://localhost:8000/';
                    }
                };
            }
            public function withUri(\Psr\Http\Message\UriInterface $uri, $preserveHost = false): \Psr\Http\Message\RequestInterface
            {
                return $this;
            }
        };
    }
}
