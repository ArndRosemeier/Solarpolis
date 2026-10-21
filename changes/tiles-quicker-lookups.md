# Ground tiles build a little faster again

- The ground streams in a little faster: the district lookup skips neighbours that cannot be nearest, and a few slow distance calculations in the ground's inner loops are done the quick way.
