package handlers

import "github.com/enowdev/enowx/core/model"

// usageStream wraps a model.Stream and remembers the last usage seen so the
// handler can log token counts after the response is written.
type usageStream struct {
	inner model.Stream
	usage model.Usage
}

func wrapUsage(s model.Stream) *usageStream { return &usageStream{inner: s} }

func (u *usageStream) Recv() (model.Event, error) {
	ev, err := u.inner.Recv()
	if ev.Usage != nil {
		u.usage = *ev.Usage
	}
	return ev, err
}

func (u *usageStream) Close() error { return u.inner.Close() }
