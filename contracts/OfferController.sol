// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IOfferController } from "./interfaces/IOfferController.sol";
import { Signatures } from "./Signatures.sol";

import { Lien, LoanOffer, BorrowOffer, MarketOffer } from "./Structs.sol";
import { OfferExpired, InvalidLoanAmount, InsufficientOffer, OfferUnavailable, BidCannotBorrow } from "./Errors.sol";

contract OfferController is IOfferController, Signatures {

    mapping(address => mapping(uint256 => uint256)) public cancelledOrFulfilled;
    mapping(bytes32 => uint256) private _amountTaken;
   
    uint256[50] private _gap;

    constructor() Signatures() {}

    function _takeLoanOffer(
        uint256 lienId,
        LoanOffer calldata offer,
        Lien memory lien,
        bytes calldata signature
    ) internal {
        
        bytes32 _offerHash = _hashLoanOffer(offer);
        _validateOffer(_offerHash, offer.lender, offer.expiration, offer.salt, signature);

        // check if amount is outside of range
        if (
            lien.principal > offer.terms.maxAmount ||
            lien.principal < offer.terms.minAmount
        ) {
            revert InvalidLoanAmount();
        }

        // check if there is sufficient amount left in the offer
        uint256 __amountTaken = _amountTaken[_offerHash];
        if (offer.terms.totalAmount - __amountTaken < lien.principal) {
            revert InsufficientOffer();
        }

        // update amount taken by specific loan offer
        unchecked {
            _amountTaken[_offerHash] = __amountTaken + lien.principal;
        }

        emit LoanOfferTaken(lienId, msg.sender, _offerHash);
    }

    function _takeBorrowOffer(
        uint256 lienId,
        BorrowOffer calldata offer,
        Lien memory lien,
        bytes calldata signature
    ) internal {
        
        bytes32 _offerHash = _hashBorrowOffer(offer);
        _validateOffer(_offerHash, offer.borrower, offer.expiration, offer.salt, signature);


        // mark offer as taken
        cancelledOrFulfilled[offer.borrower][offer.salt] = 1;

        emit BorrowOfferTaken(lienId, msg.sender, _offerHash);
    }

    function _takeMarketOffer(
        MarketOffer calldata offer,
        bytes calldata signature
    ) internal {

        bytes32 _offerHash = _hashMarketOffer(offer);
        _validateOffer(_offerHash, offer.maker, offer.expiration, offer.salt, signature);

        if (offer.terms.withLoan) {
            if (offer.terms.amount < offer.terms.borrowAmount) {
                revert BidCannotBorrow();
            }
        }

        // mark offer as taken
        cancelledOrFulfilled[offer.maker][offer.salt] = 1;

        emit MarketOfferTaken(msg.sender, _hashMarketOffer(offer));
    }

    function _validateOffer(
        bytes32 offerHash,
        address signer,
        uint256 expiration,
        uint256 salt,
        bytes calldata signature
    ) internal view {
        _verifyOfferAuthorization(offerHash, signer, signature);

        if (expiration < block.timestamp) {
            revert OfferExpired();
        }
        if (cancelledOrFulfilled[signer][salt] == 1) {
            revert OfferUnavailable();
        }
    }

    /// @notice Cancels offer salt for caller
    /// @param salt Unique offer salt
    function cancelOffer(uint256 salt) external {
        _cancelOffer(msg.sender, salt);
    }

    /// @notice Cancels offers in bulk for caller
    /// @param salts List of offer salts
    function cancelOffers(uint256[] calldata salts) external {
        uint256 saltsLength = salts.length;
        for (uint256 i; i < saltsLength; ) {
            _cancelOffer(msg.sender, salts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Cancels all offers by incrementing caller nonce
    function incrementNonce() external {
        _incrementNonce(msg.sender);
    }

    /// @notice Cancel offer by user and salt
    /// @param user Address of user
    /// @param salt Unique offer salt
    function _cancelOffer(address user, uint256 salt) private {
        cancelledOrFulfilled[user][salt] = 1;
        emit OfferCancelled(user, salt);
    }

    /// @notice Cancel all orders by incrementing the user nonce
    /// @param user Address of user
    function _incrementNonce(address user) internal {
        emit NonceIncremented(user, ++nonces[user]);
    }
}